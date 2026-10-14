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

export function storageKind(): StorageKind {
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'blob'
  if (process.env.VERCEL) {
    throw new AppError(503, 'Photo storage is not set up. In Vercel open Storage → Create → Blob (private), connect it to this project, then redeploy.')
  }
  return 'local'
}

export function storageStatus() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return { ready: true, kind: 'blob' as const }
  if (process.env.VERCEL) return { ready: false, kind: 'blob' as const }
  return { ready: true, kind: 'local' as const }
}

/** Save bytes; returns the stored path. */
export async function saveFile(kind: StorageKind, key: string, bytes: Buffer, contentType: string) {
  if (kind === 'blob') {
    try {
      const r = await blobPut(key, bytes, { access: blobAccess(), contentType, addRandomSuffix: true })
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
    const r = await blobGet(key, { access: blobAccess() })
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
  if (blobs.length && process.env.BLOB_READ_WRITE_TOKEN) await blobDel(blobs).catch(() => undefined)
  for (const i of items.filter((x) => x.storage === 'local')) {
    const file = path.join(localDir(), i.path)
    if (file.startsWith(localDir())) await rm(file, { force: true }).catch(() => undefined)
  }
}
