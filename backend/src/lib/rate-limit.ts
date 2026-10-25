/**
 * Small in-memory failure counter: at most `max` hits per key inside a sliding window.
 * Used to slow down password and owner-PIN guessing. State lives in this process only, which is enough for
 * one server or one warm serverless instance; the constant delays in the callers cover the rest.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Seconds until this key may try again, or 0 when it is allowed now. */
  retryAfter(key: string, now = Date.now()) {
    const h = this.hits.get(key)
    if (!h || h.resetAt <= now) return 0
    return h.count >= this.max ? Math.max(1, Math.ceil((h.resetAt - now) / 1000)) : 0
  }

  /** Records one failure. */
  hit(key: string, now = Date.now()) {
    if (this.hits.size > 10_000) for (const [k, h] of this.hits) if (h.resetAt <= now) this.hits.delete(k)
    const h = this.hits.get(key)
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
    else h.count++
  }

  /** Forgets a key (after a successful attempt). */
  reset(key: string) {
    this.hits.delete(key)
  }

  /** Forgets everything (tests). */
  clear() {
    this.hits.clear()
  }
}

export const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
