// Read PDF invoices in the browser (pdf.js): exact text when the PDF has it, page images for OCR + keeping.
// legacy build = polyfills for browsers older than the newest Chrome (pdf.js 6 needs very new JS otherwise)
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

export interface PdfPage {
  /** text laid out in lines, columns separated by 3+ spaces ('' when the page is only a picture) */
  text: string
  /** the page drawn as a JPEG (~1800 px) — for OCR and to keep with the invoice */
  image: Blob
  width: number
  height: number
}

const MAX_PAGES = 10

interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

/** Put pdf text pieces back into lines (top → bottom) and keep wide gaps as column breaks. */
function layoutText(items: TextItem[]) {
  const pieces = items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 8 }))
  pieces.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: (typeof pieces)[] = []
  for (const p of pieces) {
    const line = lines.find((l) => Math.abs(l[0].y - p.y) <= Math.max(2, p.h * 0.4))
    if (line) line.push(p)
    else lines.push([p])
  }
  return lines
    .map((l) => {
      l.sort((a, b) => a.x - b.x)
      let out = ''
      let end = -Infinity
      for (const p of l) {
        const gap = p.x - end
        if (out) out += gap > p.h * 1.5 ? '     ' : gap > p.h * 0.15 ? ' ' : ''
        out += p.s
        end = p.x + p.w
      }
      return out.trimEnd()
    })
    .join('\n')
}

export async function readPdf(file: Blob, stage: (m: string) => void = () => undefined): Promise<PdfPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  } catch (e) {
    throw new Error(/password/i.test(String(e)) ? 'This PDF is password-protected. Save it without a password and try again.' : 'This PDF cannot be opened.')
  }
  const count = Math.min(doc.numPages, MAX_PAGES)
  const pages: PdfPage[] = []
  for (let n = 1; n <= count; n++) {
    stage(`Reading PDF page ${n} of ${count}…`)
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    const text = layoutText(content.items as TextItem[])
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(3, 1800 / Math.max(base.width, base.height))
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
    const image = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the PDF page'))), 'image/jpeg', 0.85))
    pages.push({ text: /\d/.test(text) && text.replace(/\s/g, '').length > 40 ? text : '', image, width: canvas.width, height: canvas.height })
  }
  if (doc.numPages > MAX_PAGES) stage(`Only the first ${MAX_PAGES} pages were read`)
  return pages
}

/** sha-256 of a file — used to stop the same PDF being attached twice */
export async function fileHash(file: Blob) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
