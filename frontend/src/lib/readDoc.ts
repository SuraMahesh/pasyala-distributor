// One entry point for "read this invoice": photo → OCR; PDF → exact text (or OCR of each page if it is a scan).
import { ocrInvoiceImage } from './ocr'

export interface ReadDocument {
  text: string
  /** turn (deg, clockwise) that makes a photo upright */
  rotation: number
  previewUrl: string
  /** PDF pages drawn as images, to keep with the invoice */
  pages?: { blob: Blob; sha256: string }[]
  /** the text came straight from the PDF (no OCR guessing) */
  exactText: boolean
}

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

export async function readDocument(file: File, stage: (m: string) => void): Promise<ReadDocument> {
  if (!isPdf(file)) {
    const { text, rotation } = await ocrInvoiceImage(file, stage)
    return { text, rotation, previewUrl: URL.createObjectURL(file), exactText: false }
  }
  const { readPdf, fileHash } = await import('./pdf')
  const [pages, hash] = await Promise.all([readPdf(file, stage), fileHash(file)])
  if (!pages.length) throw new Error('This PDF has no pages.')
  const texts: string[] = []
  let exact = true
  for (const [i, p] of pages.entries()) {
    if (p.text) texts.push(p.text)
    else {
      exact = false
      const r = await ocrInvoiceImage(p.image, (m) => stage(`Page ${i + 1}: ${m}`))
      texts.push(r.text)
    }
  }
  const pageIds = await Promise.all(pages.map(async (_p, i) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${hash}:page${i + 1}`))
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }))
  return {
    text: texts.join('\n'),
    rotation: 0,
    previewUrl: URL.createObjectURL(pages[0].image),
    pages: pages.map((p, i) => ({ blob: p.image, sha256: pageIds[i] })),
    exactText: exact,
  }
}
