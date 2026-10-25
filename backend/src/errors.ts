import Anthropic from '@anthropic-ai/sdk'
import type { ErrorRequestHandler } from 'express'
import { keyHelp, keyMismatch, llmProvider, PROVIDER_LABEL } from './services/llm'
import { ZodError, type ZodType } from 'zod'

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new AppError(404, `${what} not found`)
export const conflict = (msg: string, details?: unknown) => new AppError(409, msg, details)
export const badRequest = (msg: string) => new AppError(400, msg)

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data)
}

export function idParam(v: unknown) {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw badRequest('Invalid id')
  return n
}

function pgCode(err: unknown): { code?: string; constraint?: string; detail?: string } {
  let e: unknown = err
  // drizzle wraps driver errors in `cause`
  for (let i = 0; i < 3 && e && typeof e === 'object'; i++) {
    const o = e as { code?: string; cause?: unknown }
    if (typeof o.code === 'string' && /^[0-9A-Z]{5}$/.test(o.code)) return o as never
    e = o.cause
  }
  return {}
}

/**
 * Turns a failure from the Anthropic SDK (assistant, invoice scanning) into a message the user can act on.
 * Never returns 401: the web app treats 401 as "logged out", and this is a server-key problem, not a login problem.
 */
export function anthropicError(err: unknown): AppError | null {
  if (!(err instanceof Anthropic.APIError)) return null
  const provider = llmProvider()
  const who = PROVIDER_LABEL[provider]
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    const why = keyMismatch(process.env.ANTHROPIC_API_KEY ?? '', provider) ?? keyHelp(provider)
    return new AppError(503, `${who} rejected the server's API key. ${why} Then restart (or redeploy) the server.`)
  }
  if (err instanceof Anthropic.RateLimitError) {
    const extra = provider === 'openrouter' ? ' Free OpenRouter models have a per-minute and a daily request limit.' : ''
    return new AppError(429, `${who} is rate-limiting this server — wait a minute and try again.${extra}`)
  }
  if (err instanceof Anthropic.NotFoundError) return new AppError(503, `${who} could not find that model — check ASSISTANT_MODEL / ANTHROPIC_MODEL on the server. (${err.message})`)
  if (err instanceof Anthropic.APIConnectionError) return new AppError(503, `Could not reach ${who} — check the server's internet connection and try again.`)
  if (err instanceof Anthropic.InternalServerError) return new AppError(503, `${who} is busy or down right now — try again in a moment.`)
  return new AppError(502, `${who} rejected the request: ${err.message}`)
}

/** "Invalid input: expected number, received NaN" → "Page must be a number"; a missing field → "Size is required". */
function friendlyIssue(issue: ZodError['issues'][number], field: string) {
  if (issue.code !== 'invalid_type' || !issue.message.startsWith('Invalid input')) return issue.message
  const label = field ? field.split('.').pop()!.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) : 'Value'
  if (/received (undefined|null)/.test(issue.message)) return / Id$/.test(label) ? `Choose a ${label.replace(/ Id$/, '').toLowerCase()}` : `${label} is required`
  const expected = (issue as { expected?: string }).expected
  return expected ? `${label} must be a ${expected}` : `${label} is not valid`
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const issue = err.issues[0]
    const field = issue.path.filter((p) => typeof p !== 'number').join('.')
    const line = issue.path.find((p) => typeof p === 'number')
    const where = line !== undefined ? `Line ${Number(line) + 1}: ` : ''
    res.status(400).json({ error: `${where}${friendlyIssue(issue, field)}`, field, issues: err.issues })
    return
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, details: err.details })
    return
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'The request is too large — use a smaller photo or fewer lines' })
    return
  }
  const ai = anthropicError(err)
  if (ai) {
    console.error(`[llm] ${err instanceof Anthropic.APIError && err.status ? err.status : 'connection error'}: ${(err as Error).message}`)
    res.status(ai.status).json({ error: ai.message })
    return
  }
  const pgErr = pgCode(err)
  if (pgErr.code === '23505') {
    // "Key (code)=(THBT0030) already exists." → show the value, not the database internals
    const value = /\)=\((.+?)\)/.exec(pgErr.detail ?? '')?.[1]
    res.status(409).json({ error: value ? `That code or number already exists (${value})` : 'That code or number already exists' })
    return
  }
  if (pgErr.code === '23503') {
    // a delete hit a reference to this row; a save pointed at a row that does not exist
    if (req.method === 'DELETE') res.status(409).json({ error: 'This record is used elsewhere and cannot be removed' })
    else res.status(400).json({ error: 'A product, customer, supplier or type this refers to does not exist' })
    return
  }
  if (pgErr.code === '22007' || pgErr.code === '22008') {
    res.status(400).json({ error: 'Not a real date' })
    return
  }
  if (pgErr.code === '23514') {
    const known: Record<string, string> = { payments_amount_ck: 'Amount must be at least 0.01' }
    res.status(400).json({ error: known[pgErr.constraint ?? ''] ?? 'Value not allowed' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Something went wrong on the server' })
}
