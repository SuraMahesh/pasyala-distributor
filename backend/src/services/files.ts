import { del as blobDel, get as blobGet, put as blobPut } from '@vercel/blob'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { AppError } from '../errors'

/**
 * Where invoice photos live:
 *  - Vercel Blob (private store) when BLOB_READ_WRITE_TOKEN is set — production on Vercel
 *  - a folder on this computer otherwise (UPLOAD_DIR, default backend/.data/uploads) — local use
 */
export type StorageKind = 'blob' | 'local'

const blobAccess = () => (process.env.BLOB_ACCESS === 'public' ? 'public' : 'private') as 'public' | 'private'
const localDir = () => path.resolve(process.env.UPLOAD_DIR ?? path.join(process.cwd(), '.data', 'uploads'))

/**
 * How to reach the Blob store. Vercel connects a store in one of two ways:
 *  - BLOB_READ_WRITE_TOKEN (classic token), or
 *  - BLOB_STORE_ID + automatic Vercel OIDC login (newer stores — there is no token variable).
 * If a custom prefix was chosen when connecting (e.g. PHOTOS_READ_WRITE_TOKEN), that is found too.
 */
function blobAuth(): { token?: string; storeId?: string; via: 'token' | 'oidc' } | null {
  const env = process.env
  if (env.BLOB_READ_WRITE_TOKEN) return { via: 'token' }
  if (env.BLOB_STORE_ID) return { via: 'oidc' }
  const tokenKey = Object.keys(env).find((k) => k.endsWith('_READ_WRITE_TOKEN') && env[k]?.startsWith('vercel_blob_rw_'))
  if (tokenKey) return { token: env[tokenKey], via: 'token' }
  const storeKey = Object.keys(env).find((k) => k.endsWith('_STORE_ID') && env[k]?.startsWith('store_'))
  if (storeKey) return { storeId: env[storeKey], via: 'oidc' }
  return null
}
const blobOpts = () => {
  const a = blobAuth()
  return { ...(a?.token ? { token: a.token } : {}), ...(a?.storeId ? { storeId: a.storeId } : {}) }
}

export function storageKind(): StorageKind {
  if (blobAuth()) return 'blob'
  if (process.env.VERCEL) {
    throw new AppError(503, 'Photo storage is not set up. In Vercel open Storage → Create → Blob (private), connect it to this project (Production), then redeploy.')
  }
  return 'local'
}

/** For the screen — variable names only, never values. */
export function storageStatus() {
  const a = blobAuth()
  const found = Object.keys(process.env).filter((k) => /(^BLOB_|_READ_WRITE_TOKEN$|_STORE_ID$)/.test(k) && !k.startsWith('BLOB_PRESIGN')).sort()
  if (a) return { ready: true, kind: 'blob' as const, via: a.via, found }
  if (process.env.VERCEL) return { ready: false, kind: 'blob' as const, via: null, found, environment: process.env.VERCEL_ENV ?? null }
  return { ready: true, kind: 'local' as const, via: null, found }
}

/** Save bytes; returns the stored path. */
export async function saveFile(kind: StorageKind, key: string, bytes: Buffer, contentType: string) {
  if (kind === 'blob') {
    try {
      const r = await blobPut(key, bytes, { access: blobAccess(), contentType, addRandomSuffix: true, ...blobOpts() })
      return r.pathname
    } catch (e) {
      throw new AppError(502, `Could not save the photo to Vercel Blob: ${(e as Error).message}`)
    }
  }
  const file = path.join(localDir(), key)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, bytes)
  return key
}

export async function readFile(kind: StorageKind, key: string): Promise<Readable | null> {
  if (kind === 'blob') {
    const r = await blobGet(key, { access: blobAccess(), ...blobOpts() })
    if (!r || r.statusCode !== 200) return null
    return Readable.fromWeb(r.stream as never)
  }
  const file = path.join(localDir(), key)
  if (!file.startsWith(localDir()) || !existsSync(file)) return null
  return createReadStream(file)
}

/** Best effort — a missing file is not an error. */
export async function removeFiles(items: { storage: string; path: string }[]) {
  const blobs = items.filter((i) => i.storage === 'blob').map((i) => i.path)
  if (blobs.length && blobAuth()) await blobDel(blobs, blobOpts()).catch(() => undefined)
  for (const i of items.filter((x) => x.storage === 'local')) {
    const file = path.join(localDir(), i.path)
    if (file.startsWith(localDir())) await rm(file, { force: true }).catch(() => undefined)
  }
}
