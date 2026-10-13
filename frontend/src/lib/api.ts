// Thin fetch wrapper for the backend REST API.

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') + '/api'

export class ApiError extends Error {
  status: number
  details?: unknown
  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

// ---- login token (kept in this browser only)
const TOKEN_KEY = 'pjd-token'
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}
export function setToken(t: string) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode — stays logged in for this tab only */
  }
}
export const authHeaders = (): Record<string, string> => (getToken() ? { Authorization: `Bearer ${getToken()}` } : {})

type Params = Record<string, string | number | boolean | null | undefined>

export function qs(params?: Params) {
  if (!params) return ''
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...authHeaders(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check that the backend is running and you are online.')
  }
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('pjd:logout'))
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details)
  return data as T
}

export const api = {
  get: <T>(path: string, params?: Params) => request<T>('GET', path + qs(params)),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T = { ok: true }>(path: string) => request<T>('DELETE', path),
  url: (path: string) => BASE + path,
}

/** Every row of a paged list (for Excel exports) — walks the pages 200 at a time. */
export async function fetchAll<T>(path: string, params: Params = {}): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; ; page++) {
    const r = await api.get<{ items: T[]; total: number }>(path, { ...params, page, pageSize: 200 })
    out.push(...r.items)
    if (out.length >= r.total || !r.items.length) return out
  }
}
