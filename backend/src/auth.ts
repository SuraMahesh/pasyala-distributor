import { createHmac, timingSafeEqual } from 'node:crypto'
import { Router, type RequestHandler } from 'express'
import { z } from 'zod'

/**
 * Simple shared-password login.
 *  - APP_PASSWORD set   → every /api call (except /health and /auth/*) needs a valid token.
 *  - APP_PASSWORD unset → open (local development). On Vercel it refuses to run open.
 * Tokens are HMAC-signed "expiry" strings, valid for 30 days; changing APP_PASSWORD
 * (or AUTH_SECRET) logs everyone out.
 */
const DAYS = 30

const password = () => process.env.APP_PASSWORD ?? ''
const secret = () => process.env.AUTH_SECRET || `pjd:${password()}`

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function issueToken(now = Date.now()) {
  const exp = String(now + DAYS * 86_400_000)
  return `${exp}.${sign(exp)}`
}

export function verifyToken(token: string, now = Date.now()) {
  const [exp, sig] = token.split('.')
  if (!exp || !sig || Number(exp) < now) return false
  const a = Buffer.from(sig)
  const b = Buffer.from(sign(exp))
  return a.length === b.length && timingSafeEqual(a, b)
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export const authEnabled = () => password().length > 0

export function authRoutes() {
  const r = Router()
  r.get('/auth/me', (req, res) => {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    res.json({ required: authEnabled(), loggedIn: !authEnabled() || verifyToken(token) })
  })
  r.post('/auth/login', async (req, res) => {
    const { password: given } = z.object({ password: z.string().max(200) }).parse(req.body)
    if (!authEnabled()) {
      res.json({ token: '' })
      return
    }
    if (!safeEqual(given, password())) {
      await new Promise((ok) => setTimeout(ok, 600)) // slow down guessing
      res.status(401).json({ error: 'Wrong password' })
      return
    }
    res.json({ token: issueToken() })
  })
  return r
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!authEnabled()) {
    if (process.env.VERCEL) {
      res.status(503).json({ error: 'Set APP_PASSWORD in the Vercel project settings, then redeploy.' })
      return
    }
    next()
    return
  }
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (token && verifyToken(token)) {
    next()
    return
  }
  res.status(401).json({ error: 'Please log in' })
}
