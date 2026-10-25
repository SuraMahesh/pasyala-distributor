import { timingSafeEqual } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { Router, type Request } from 'express'
import { z } from 'zod'
import { todayLK } from '@pjd/shared'
import { hmac } from '../auth'
import type { DB } from '../db/client'
import { AppError, badRequest, idParam, parse } from '../errors'
import { RateLimiter, sleep } from '../lib/rate-limit'
import { runAssistantTurn, type ChatMessage } from '../services/assistant'
import { applyRequest, listRequests, rejectRequest } from '../services/assistant-approvals'
import { assistantData } from '../services/assistant-data'
import { defaultAssistantModel, keyMismatch, llmProvider } from '../services/llm'

const HISTORY_MAX_BYTES = 400_000 // the whole conversation the browser sends back, serialised
const chatSchema = z.object({
  userName: z.string().trim().min(1, 'Tell the assistant your name').max(60),
  text: z.string().trim().min(1).max(2000),
  // the `history` + `sig` from the previous reply, unchanged — the signature proves nothing was edited in the browser
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.unknown() }).passthrough()).max(80).default([]),
  sig: z.string().max(200).default(''),
})
const decisionSchema = z.object({
  approver: z.string().trim().min(1, 'Approver name is required').max(60),
  pin: z.string().max(50),
  note: z.string().trim().max(300).default(''),
})

const pinLimiter = new RateLimiter(5, 15 * 60_000) // wrong PINs per IP per 15 minutes
const pinLimiterAll = new RateLimiter(25, 15 * 60_000) // … and in total, whatever the IP
/** Tests only. */
export const _resetPinLimits = () => {
  pinLimiter.clear()
  pinLimiterAll.clear()
}

async function requireOwnerPin(req: Request, pin: string) {
  const want = process.env.OWNER_PIN ?? ''
  if (!want) throw badRequest('Set OWNER_PIN on the server to enable approvals')
  const ip = req.ip ?? 'unknown'
  const wait = Math.max(pinLimiter.retryAfter(ip), pinLimiterAll.retryAfter('all'))
  if (wait) throw new AppError(429, `Too many wrong PINs. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.`)
  const a = Buffer.from(pin)
  const b = Buffer.from(want)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    pinLimiter.hit(ip)
    pinLimiterAll.hit('all')
    await sleep(500) // a wrong guess always costs half a second
    throw new AppError(403, 'Wrong owner PIN')
  }
  pinLimiter.reset(ip)
}

const signHistory = (history: unknown[]) => hmac(JSON.stringify(history))

export function assistantRoutes(db: DB) {
  const r = Router()
  const key = process.env.ANTHROPIC_API_KEY
  const client = key ? new Anthropic({ apiKey: key }) : null // base URL: ANTHROPIC_BASE_URL (read by the SDK), default api.anthropic.com
  const mismatch = key ? keyMismatch(key) : null
  if (mismatch) console.warn(`[assistant] ${mismatch} The assistant and invoice scanning will fail until this is fixed.`)

  r.get('/assistant/status', (_req, res) => {
    res.json({ enabled: !!client, approvals: !!process.env.OWNER_PIN, provider: llmProvider(), model: process.env.ASSISTANT_MODEL || defaultAssistantModel() })
  })

  r.post('/assistant/chat', async (req, res) => {
    if (!client) throw badRequest('Set ANTHROPIC_API_KEY to enable the assistant')
    const body = parse(chatSchema, req.body)
    if (JSON.stringify(body.history).length > HISTORY_MAX_BYTES) throw new AppError(413, 'This conversation is too long — start a new chat.')
    if (body.history.length && body.sig !== signHistory(body.history)) throw badRequest('This conversation is out of date — start a new chat.')
    const result = await runAssistantTurn({
      client,
      data: assistantData(db),
      history: body.history as ChatMessage[],
      userText: body.text,
      userName: body.userName,
      today: todayLK(),
      model: process.env.ASSISTANT_MODEL,
    })
    console.log(JSON.stringify({ assistant: true, user: body.userName, stop: result.stopReason, usage: result.usage }))
    res.json({ reply: result.reply, history: result.history, sig: signHistory(result.history) })
  })

  r.get('/assistant/requests', async (req, res) => {
    res.json(await listRequests(db, req.query.status === 'all' ? 'all' : 'pending'))
  })
  r.post('/assistant/requests/:id/approve', async (req, res) => {
    const { approver, pin } = parse(decisionSchema, req.body)
    await requireOwnerPin(req, pin)
    res.json(await applyRequest(db, idParam(req.params.id), approver))
  })
  r.post('/assistant/requests/:id/reject', async (req, res) => {
    const { approver, pin, note } = parse(decisionSchema, req.body)
    await requireOwnerPin(req, pin)
    res.json(await rejectRequest(db, idParam(req.params.id), approver, note))
  })
  return r
}
