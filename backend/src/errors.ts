import type { ErrorRequestHandler } from 'express'
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

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const issue = err.issues[0]
    const field = issue.path.filter((p) => typeof p !== 'number').join('.')
    const line = issue.path.find((p) => typeof p === 'number')
    const where = line !== undefined ? `Line ${Number(line) + 1}: ` : ''
    res.status(400).json({ error: `${where}${issue.message}`, field, issues: err.issues })
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
  const pgErr = pgCode(err)
  if (pgErr.code === '23505') {
    res.status(409).json({ error: 'That code or number already exists', detail: pgErr.detail })
    return
  }
  if (pgErr.code === '23503') {
    res.status(409).json({ error: 'This record is used elsewhere and cannot be removed', detail: pgErr.detail })
    return
  }
  if (pgErr.code === '23514') {
    res.status(400).json({ error: 'Value not allowed', detail: pgErr.constraint })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Something went wrong on the server' })
}
