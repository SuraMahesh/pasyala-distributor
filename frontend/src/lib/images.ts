import type { ImageInvoiceKind, InvoiceImage } from '@pjd/shared'
import { api, getToken } from './api'

/** URL for an invoice photo (the login token goes in the link because <img> cannot send headers). */
export function imageUrl(id: number, opts: { thumb?: boolean; download?: boolean } = {}) {
  const p = new URLSearchParams()
  if (opts.thumb) p.set('size', 'thumb')
  if (opts.download) p.set('download', '1')
  const t = getToken()
  if (t) p.set('t', t)
  const qs = p.toString()
  return api.url(`/images/${id}/file${qs ? `?${qs}` : ''}`)
}

async function sha256Hex(file: Blob) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('Could not read the photo'))
    r.readAsDataURL(blob)
  })
}

async function jpeg(bitmap: ImageBitmap, longEdge: number, qualities: number[], maxBytes: number) {
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bitmap.width * scale)
  c.height = Math.round(bitmap.height * scale)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, c.width, c.height)
  for (const q of qualities) {
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', q))
    if (blob && blob.size <= maxBytes) return { blob, width: c.width, height: c.height }
  }
  throw new Error('The photo is too large — try again with a lower camera resolution.')
}

export interface PreparedPhoto {
  mimeType: 'image/jpeg'
  data: string
  thumb: string
  sha256: string
  width: number
  height: number
  previewUrl: string
  bytes: number
}

/** Shrink a phone photo to a sharp ~1800 px JPEG (~200–400 KB) plus a small preview. */
export async function preparePhoto(file: Blob, opts: { sha256?: string } = {}): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo (JPG or PNG).')
  const sha256 = opts.sha256 ?? (await sha256Hex(file))
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This photo cannot be opened. Take it as JPG, or screenshot it and upload the screenshot.')
  }
  const main = await jpeg(bitmap, 1800, [0.75, 0.68, 0.6, 0.5], 1_500_000)
  const small = await jpeg(bitmap, 320, [0.7, 0.55], 200_000)
  return {
    mimeType: 'image/jpeg',
    data: await toBase64(main.blob),
    thumb: await toBase64(small.blob),
    sha256,
    width: main.width,
    height: main.height,
    previewUrl: URL.createObjectURL(main.blob),
    bytes: main.blob.size,
  }
}

const base = (kind: ImageInvoiceKind) => (kind === 'sale' ? 'sales' : 'purchases')

export async function uploadPhoto(kind: ImageInvoiceKind, invoiceId: number, photo: PreparedPhoto) {
  const { previewUrl: _p, bytes: _b, ...body } = photo
  return api.post<InvoiceImage>(`/${base(kind)}/${invoiceId}/images`, body)
}

export const listPhotos = (kind: ImageInvoiceKind, invoiceId: number) => api.get<InvoiceImage[]>(`/${base(kind)}/${invoiceId}/images`)

const rotatedCache = new Map<string, Promise<string>>()

/** Image URL turned clockwise by `rotation` degrees (drawn once in the browser, then cached). */
export function rotatedSrc(url: string, rotation: number): Promise<string> {
  if (!rotation) return Promise.resolve(url)
  const key = `${url}#${rotation}`
  let p = rotatedCache.get(key)
  if (!p) {
    p = (async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error('Could not load the photo')
      const bmp = await createImageBitmap(await res.blob())
      const side = rotation % 180 !== 0
      const c = document.createElement('canvas')
      c.width = side ? bmp.height : bmp.width
      c.height = side ? bmp.width : bmp.height
      const ctx = c.getContext('2d')!
      ctx.translate(c.width / 2, c.height / 2)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9))
      return blob ? URL.createObjectURL(blob) : url
    })()
    p.catch(() => rotatedCache.delete(key))
    rotatedCache.set(key, p)
  }
  return p
}

/** A photo, or every page of a PDF (drawn as images), ready to attach. Same PDF twice → same ids → refused. */
export async function prepareFiles(file: File, stage?: (m: string) => void): Promise<PreparedPhoto[]> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const { readPdf, fileHash } = await import('./pdf')
    const [pages, hash] = await Promise.all([readPdf(file, stage), fileHash(file)])
    const out: PreparedPhoto[] = []
    for (const [i, p] of pages.entries()) {
      const pageHash = await sha256Hex(new Blob([`${hash}:page${i + 1}`]))
      out.push(await preparePhoto(p.image, { sha256: pageHash }))
    }
    return out
  }
  return [await preparePhoto(file)]
}
