// Offline invoice reading in the browser (Tesseract OCR) — used when the server has no AI key.
import { ocrScore } from '@pjd/shared'
import type { Worker } from 'tesseract.js'

type Stage = (message: string) => void

let workerPromise: Promise<Worker> | null = null
let onLoadProgress: ((p: number) => void) | null = null

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      const base = new URL('/ocr/', window.location.origin).href
      const worker = await createWorker('eng', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base.replace(/\/$/, ''),
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          if (m.status.startsWith('loading') && onLoadProgress) onLoadProgress(m.progress)
        },
      })
      // 4 = one column of text of varying sizes — keeps each invoice row on one line
      await worker.setParameters({ tessedit_pageseg_mode: '4' as never, preserve_interword_spaces: '1' })
      return worker
    })().catch((e) => {
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

/**
 * Clean the photo for OCR: the brightest of R/G/B makes yellow highlighter and blue pen nearly white
 * while black print stays black; then stretch the contrast.
 */
function preprocess(bitmap: ImageBitmap, longEdge: number) {
  const scale = longEdge / Math.max(bitmap.width, bitmap.height)
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(d[i], d[i + 1], d[i + 2])
    d[i] = v
    hist[v]++
  }
  const total = w * h
  const pct = (p: number) => {
    let acc = 0
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= total * p) return v
    return 255
  }
  const lo = pct(0.02)
  const hi = Math.max(pct(0.9), lo + 1)
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.min(255, Math.max(0, ((d[i] - lo) / (hi - lo)) * 255))
    d[i] = d[i + 1] = d[i + 2] = v
    d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

function rotate(src: HTMLCanvasElement, deg: number, longEdge?: number) {
  const scale = longEdge ? longEdge / Math.max(src.width, src.height) : 1
  const sw = src.width * scale
  const sh = src.height * scale
  const side = deg % 180 !== 0
  const c = document.createElement('canvas')
  c.width = Math.round(side ? sh : sw)
  c.height = Math.round(side ? sw : sh)
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh)
  return c
}

/** Read all text on an invoice photo, turning it the right way up first. */
export async function ocrInvoiceImage(file: File, stage: Stage): Promise<string> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('This image cannot be opened. Take the photo as JPG, or screenshot it and upload the screenshot.')
  }
  stage('Loading the text reader (first time only, about 7 MB)…')
  onLoadProgress = (p) => stage(`Loading the text reader… ${Math.round(p * 100)}%`)
  const worker = await getWorker()
  onLoadProgress = null

  const clean = preprocess(bitmap, Math.min(3200, Math.max(bitmap.width, bitmap.height) * 2))
  // which way up? try each turn on a smaller copy and keep the one that reads like an invoice
  let best = { deg: 0, score: -1 }
  for (const [i, deg] of [0, 90, 270, 180].entries()) {
    stage(`Finding which way up the photo is… (${i + 1}/4)`)
    const { data } = await worker.recognize(rotate(clean, deg, 1600))
    const score = ocrScore(data.text)
    if (score > best.score) best = { deg, score }
    if (score >= 25) break
  }
  stage('Reading the invoice text…')
  const { data } = await worker.recognize(best.deg ? rotate(clean, best.deg) : clean)
  return data.text
}
