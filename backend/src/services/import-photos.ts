/**
 * Attaching page photos to imported invoices — either straight into the photo store (Vercel Blob or the
 * local folder, like the Invoice photos screen does on the server) or through a running ERP's API.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import type { ImageInvoiceKind } from '@pjd/shared'
import type { DB } from '../db/client'
import { invoiceImages } from '../db/schema'
import { saveFile, storageKind } from './files'
import { rows } from './stock'

/** Attach photos through a running ERP's API (its own photo store) instead of writing to the store from here. */
export interface ApiTarget {
  url: string
  password: string
}

export type Uploader = (invoiceId: number, invoiceNo: string, file: string) => Promise<boolean>

/** Width and height of a JPEG (from its SOF segment) or PNG. */
export function imageSize(b: Buffer): { width: number; height: number; mimeType: 'image/jpeg' | 'image/png' } | null {
  if (b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), mimeType: 'image/png' }
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = b.readUInt16BE(i + 2)
    const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSOF) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), mimeType: 'image/jpeg' }
    if (marker === 0xda || marker === 0xd9) return null
    i += 2 + len
  }
  return null
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'invoice'
const thumbOf = (file: string) => file.replace(/\.(jpe?g|png)$/i, '') + '-thumb.jpg'
const column = (kind: ImageInvoiceKind) => (kind === 'sale' ? sql`sales_invoice_id` : sql`purchase_invoice_id`)

/** Reads a page photo + its thumbnail the way the browser prepares them for POST /api/{sales|purchases}/:id/images. */
async function photoBody(file: string) {
  const bytes = await readFile(file)
  const thumb = await readFile(thumbOf(file))
  if (bytes.length > 1_600_000) throw new Error('photo is larger than 1.6 MB — shrink it first')
  const dims = imageSize(bytes)
  if (!dims) throw new Error('not a JPEG or PNG file')
  if (!imageSize(thumb)) throw new Error('the thumbnail is not a JPEG file')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { bytes, thumb, dims, sha256 }
}

/** How many photos an invoice already has. */
export async function photoCount(db: DB, kind: ImageInvoiceKind, invoiceId: number) {
  const [{ n }] = await rows<{ n: number }>(db, sql`select count(*)::int as n from invoice_images where ${column(kind)} = ${invoiceId}`)
  return Number(n)
}

/** Attach one page photo to an invoice the way the Invoice photos screen does. false = same photo already attached. */
export async function attachPhoto(db: DB, kind: ImageInvoiceKind, invoiceId: number, invoiceNo: string, file: string): Promise<boolean> {
  const { bytes, thumb, dims, sha256 } = await photoBody(file)
  const [dup] = await rows<{ id: number }>(db, sql`select id from invoice_images where sha256 = ${sha256}`)
  if (dup) return false
  const storage = storageKind()
  const [{ next }] = await rows<{ next: number }>(db, sql`select coalesce(max(page), 0) + 1 as next from invoice_images where ${column(kind)} = ${invoiceId}`)
  const keyBase = `invoices/${kind}/${safe(invoiceNo)}-${invoiceId}/p${next}`
  const stored = await saveFile(storage, `${keyBase}.${dims.mimeType === 'image/png' ? 'png' : 'jpg'}`, bytes, dims.mimeType)
  const thumbPath = await saveFile(storage, `${keyBase}-thumb.jpg`, thumb, 'image/jpeg')
  await db.insert(invoiceImages).values({
    salesInvoiceId: kind === 'sale' ? invoiceId : null,
    purchaseInvoiceId: kind === 'purchase' ? invoiceId : null,
    page: next,
    storage,
    path: stored,
    thumbPath,
    mimeType: dims.mimeType,
    size: bytes.length,
    width: dims.width,
    height: dims.height,
    sha256,
  })
  return true
}

/** Logs in to a running ERP and returns an uploader that posts photos to its API. */
export async function apiUploader(api: ApiTarget, kind: ImageInvoiceKind): Promise<Uploader> {
  const base = api.url.replace(/\/+$/, '') + '/api'
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: api.password }),
  })
  const auth = (await login.json().catch(() => ({}))) as { token?: string; error?: string }
  if (!login.ok) throw new Error(`could not log in at ${api.url}: ${auth.error ?? `HTTP ${login.status}`}`)
  const headers = { 'content-type': 'application/json', ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}) }
  const path = kind === 'sale' ? 'sales' : 'purchases'
  return async (invoiceId, _invoiceNo, file) => {
    const { bytes, thumb, dims, sha256 } = await photoBody(file)
    const res = await fetch(`${base}/${path}/${invoiceId}/images`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mimeType: dims.mimeType, data: bytes.toString('base64'), thumb: thumb.toString('base64'), sha256, width: dims.width, height: dims.height }),
    })
    if (res.status === 409) return false
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(err.error ?? `HTTP ${res.status} from ${api.url}`)
    }
    return true
  }
}

/** The uploader to use: the photo store directly, or a running site's API. */
export async function chooseUploader(db: DB, kind: ImageInvoiceKind, api?: ApiTarget): Promise<Uploader> {
  if (api) return apiUploader(api, kind)
  return (id, no, f) => attachPhoto(db, kind, id, no, f)
}
