import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import type { DB } from './db/client'
import { settings } from './db/schema'
import { RateLimiter, sleep } from './lib/rate-limit'

/**
 * Simple shared-password login.
 *  - APP_PASSWORD set   → every /api call (except /health and /auth/*) needs a valid token.
 *  - APP_PASSWORD unset → open (local development). On Vercel it refuses to run open.
 *
 * Tokens are HMAC-signed with a random secret that is generated once and kept in the settings table
 * (AUTH_SECRET overrides it), so a leaked token cannot be used to guess the password offline.
 * The password's hash is part of what is signed: changing APP_PASSWORD (or the secret) logs everyone out.
 * Two kinds of token exist: the 30-day session token (Authorization header) and a 7-day read-only
 * image token that only opens photo files, because <img src> cannot send a header and the link ends up in logs.
 */
const SESSION_DAYS = 30
const IMAGE_DAYS = 7
const LOGIN_DELAY_MS = 500 // same on success and failure, so timing says nothing
const loginLimiter = new RateLimiter(10, 15 * 60_000) // wrong passwords per IP per 15 minutes

type TokenKind = 'session' | 'image'

const password = () => process.env.APP_PASSWORD ?? ''
const authEnabled = () => password().length > 0

let secretValue: string | undefined = process.env.AUTH_SECRET || undefined
let secretReady: Promise<string> | undefined

/**
 * Loads the signing secret from the settings row, creating one on first run. Called once by createApp;
 * requests wait for it. Safe to call again (returns the same promise, or retries after a failure).
 */
export function initAuth(db: DB) {
  secretReady ??= (async () => {
    if (secretValue) return secretValue
    const read = async () => (await db.select({ s: settings.authSecret }).from(settings).where(eq(settings.id, 1)))[0]?.s ?? null
    let s = await read()
    if (!s) {
      const fresh = randomBytes(32).toString('base64url')
      // only fill an empty slot — two instances starting together must end up with the same secret
      await db.update(settings).set({ authSecret: fresh }).where(and(eq(settings.id, 1), isNull(settings.authSecret)))
      s = await read()
      if (!s) {
        await db.insert(settings).values({ id: 1, name: 'My business', authSecret: fresh }).onConflictDoNothing()
        s = await read()
      }
      if (!s) throw new Error('Could not store the login secret in the settings table')
    }
    secretValue = s
    return s
  })()
  secretReady.catch(() => (secretReady = undefined))
  return secretReady
}

const secret = () => {
  if (!secretValue) throw new Error('Auth is not initialised — call initAuth(db) first')
  return secretValue
}
const passwordFingerprint = () => createHash('sha256').update(password()).digest('hex')
const sign = (kind: TokenKind, exp: string) => createHmac('sha256', secret()).update(`${kind}:${exp}:${passwordFingerprint()}`).digest('base64url')
const sha = (s: string) => createHash('sha256').update(s).digest()

/** Constant-time string compare that does not leak the length either. */
function safeEqual(a: string, b: string) {
  return timingSafeEqual(sha(a), sha(b)) && a.length === b.length
}

function issue(kind: TokenKind, now: number) {
  const exp = String(now + (kind === 'session' ? SESSION_DAYS : IMAGE_DAYS) * 86_400_000)
  return `${exp}.${sign(kind, exp)}`
}
const issueToken = (now = Date.now()) => issue('session', now)
const issueImageToken = (now = Date.now()) => issue('image', now)

function verifyToken(token: string, kind: TokenKind = 'session', now = Date.now()) {
  const [exp, sig] = token.split('.')
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false
  return safeEqual(sig, sign(kind, exp))
}

/** HMAC over any text with the server secret (used to sign the assistant's conversation history). */
export const hmac = (text: string) => createHmac('sha256', secret()).update(text).digest('base64url')

/** Tests only: forget login failures. */
export const _resetAuthLimits = () => loginLimiter.clear()

export function authRoutes() {
  const r = Router()
  r.get('/auth/me', async (req, res) => {
    if (secretReady) await secretReady
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const loggedIn = !authEnabled() || verifyToken(token)
    res.json({ required: authEnabled(), loggedIn, ...(loggedIn && authEnabled() ? { imageToken: issueImageToken() } : {}) })
  })
  r.post('/auth/login', async (req, res) => {
    const { password: given } = z.object({ password: z.string().max(200) }).parse(req.body)
    if (!authEnabled()) {
      res.json({ token: '', imageToken: '' })
      return
    }
    if (secretReady) await secretReady
    const ip = req.ip ?? 'unknown'
    const wait = loginLimiter.retryAfter(ip)
    if (wait) {
      res.setHeader('Retry-After', String(wait))
      res.status(429).json({ error: `Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? 's' : ''}.` })
      return
    }
    const ok = safeEqual(given, password())
    await sleep(LOGIN_DELAY_MS) // slows guessing; identical for right and wrong passwords
    if (!ok) {
      loginLimiter.hit(ip)
      res.status(401).json({ error: 'Wrong password' })
      return
    }
    loginLimiter.reset(ip)
    res.json({ token: issueToken(), imageToken: issueImageToken() })
  })
  return r
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  if (secretReady) await secretReady // the assistant signs its history even when login is off
  if (!authEnabled()) {
    if (process.env.VERCEL) {
      res.status(503).json({ error: 'Set APP_PASSWORD in the Vercel project settings, then redeploy.' })
      return
    }
    next()
    return
  }
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (bearer && verifyToken(bearer)) {
    next()
    return
  }
  // <img src="…"> cannot send a header, so photo files may carry the short-lived image token in the link (?t=)
  const photoLink = req.method === 'GET' && /^\/images\/\d+\/file$/.test(req.path) && typeof req.query.t === 'string'
  if (photoLink && verifyToken(String(req.query.t), 'image')) {
    next()
    return
  }
  res.status(401).json({ error: 'Please log in' })
}

/** Startup advice for weak settings — printed once, never blocks. */
export function warnAboutWeakAuth() {
  if (authEnabled() && password().length < 8) console.warn('[auth] APP_PASSWORD is shorter than 8 characters — use a longer password.')
  const pin = process.env.OWNER_PIN ?? ''
  if (pin && pin.length < 6) console.warn('[auth] OWNER_PIN is shorter than 6 characters — a longer PIN is much harder to guess.')
}
