import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Camera, CheckCircle2, FileImage, Loader2, ScanLine, X, ZoomIn } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { parseInvoiceText, type ScanKind, type ScanResult } from '@pjd/shared'
import { api } from '../lib/api'
import { useProductOptions } from '../lib/hooks'
import { ocrInvoiceImage } from '../lib/ocr'
import type { Draft, DraftLine } from './InvoiceEditor'
import { blankLine } from './InvoiceEditor'
import { Modal } from './ui'

const MAX_BYTES = 3_000_000 // stays under the 4.5 MB request limit on Vercel after base64

/** Shrink phone photos (often 4–12 MB) to a sharp ~2000 px JPEG, and read PDFs as they are. */
async function prepareFile(file: File): Promise<{ mimeType: string; data: string; previewUrl: string; isPdf: boolean }> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error('This PDF is too large (max 3 MB). Take a photo of the page instead.')
    const data = await toBase64(file)
    return { mimeType: 'application/pdf', data, previewUrl: URL.createObjectURL(file), isPdf: true }
  }
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo (JPG, PNG) or a PDF of the invoice.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This image type cannot be opened here. Take the photo as JPG, or screenshot it and upload the screenshot.')
  }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q))
    if (blob && blob.size <= MAX_BYTES) return { mimeType: 'image/jpeg', data: await toBase64(blob), previewUrl: URL.createObjectURL(blob), isPdf: false }
  }
  throw new Error('The photo is too large even after shrinking — try again with a lower camera resolution.')
}

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('Could not read the file'))
    r.readAsDataURL(blob)
  })
}

export interface ScanState {
  result: ScanResult
  previewUrl: string
  isPdf: boolean
  /** read offline in the browser (no AI) */
  offline?: boolean
}

/** Turn what was read from the image into an editable draft. Prices come from the image, not the price list. */
export function scanToDraft(r: ScanResult, base: Draft): Draft {
  const lines: DraftLine[] = r.lines.map((l) => ({
    ...blankLine(),
    productId: l.productId,
    qty: l.qty,
    freeQty: l.freeQty,
    unitPrice: l.unitPrice,
    discPct: l.discPct,
    manualPrice: true,
    manualFree: true,
    imageText: l.rawText,
    priceNote: 'Price from image',
  }))
  return {
    ...base,
    partyId: r.partyId ?? base.partyId,
    date: r.date ?? base.date,
    payMethod: r.payMethod ?? base.payMethod,
    billDiscPct: r.billDiscPct,
    paidTouched: false,
    invoiceNo: r.kind === 'purchase' ? r.invoiceNo : base.invoiceNo,
    orderNo: r.orderNo || base.orderNo,
    salesPerson: r.salesPerson || base.salesPerson,
    notes: r.kind === 'sale' && r.invoiceNo ? `Ref ${r.invoiceNo}${base.notes ? ` · ${base.notes}` : ''}` : base.notes,
    lines: lines.length ? lines : [blankLine()],
  }
}

/** Upload / drop / camera button that reads an invoice and hands back a draft. */
export function ScanUpload({ kind, onScanned, compact = false }: { kind: ScanKind; onScanned: (s: ScanState) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const status = useQuery({ queryKey: ['scan-status'], queryFn: () => api.get<{ enabled: boolean; ai?: boolean }>('/scan-invoice/status'), staleTime: 5 * 60_000 })
  const { data: products = [] } = useProductOptions()
  const ai = !!status.data?.ai

  const handle = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy(true)
    const t = toast.loading(ai ? 'Reading the invoice… this takes 10–30 seconds' : 'Reading the invoice on this device…')
    try {
      let state: ScanState
      if (ai) {
        const f = await prepareFile(file)
        const result = await api.post<ScanResult>('/scan-invoice', { kind, mimeType: f.mimeType, data: f.data })
        state = { result, previewUrl: f.previewUrl, isPdf: f.isPdf }
      } else {
        if (file.type === 'application/pdf') throw new Error('PDF files need the AI reader. Take a photo or a screenshot of the invoice instead.')
        const text = await ocrInvoiceImage(file, (m) => toast.loading(m, { id: t }))
        toast.loading('Matching products…', { id: t })
        const catalog = products.filter((p) => p.active).map(({ id, code, name, size, listPrice, supplierDiscPct }) => ({ id, code, name, size, listPrice, supplierDiscPct }))
        const raw = parseInvoiceText(text, kind, catalog)
        const result = await api.post<ScanResult>('/scan-invoice/parse', { kind, raw })
        state = { result, previewUrl: URL.createObjectURL(file), isPdf: false, offline: true }
      }
      const { result } = state
      const matched = result.lines.filter((l) => l.productId).length
      if (!result.lines.length) toast.warning('No item lines found — try a sharper, flatter photo in good light, or type the lines in.', { id: t, duration: 8000 })
      else toast.success(`Read ${result.lines.length} line(s) — ${matched} matched. Check them, then save.`, { id: t })
      onScanned(state)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read the invoice', { id: t, duration: 8000 })
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
      if (camera.current) camera.current.value = ''
    }
  }

  const inputs = (
    <>
      <input ref={input} type="file" accept={ai ? 'image/*,application/pdf' : 'image/*'} className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
    </>
  )

  if (compact) {
    return (
      <>
        {inputs}
        <button className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />} Scan another image
        </button>
      </>
    )
  }

  return (
    <div
      className={`card mb-4 border-2 border-dashed p-4 transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-stone-300'}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files?.[0]) }}
    >
      {inputs}
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
          {busy ? <Loader2 size={22} className="animate-spin" /> : <ScanLine size={22} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{busy ? 'Reading the invoice…' : `Have the ${kind === 'purchase' ? 'supplier' : 'sales'} invoice on paper? Scan it`}</p>
          <p className="text-sm text-stone-500">
            {ai
              ? 'Take a photo or upload an image / PDF. The form fills in for you — check every line, edit anything, then save.'
              : 'Take a flat, sharp photo in good light, or upload one. It is read on this device (free, no internet AI) — check every line, edit anything, then save.'}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button className="btn-primary flex-1 sm:hidden" disabled={busy} onClick={() => camera.current?.click()}><Camera size={16} /> Take photo</button>
          <button className="btn-secondary flex-1 sm:flex-none" disabled={busy} onClick={() => input.current?.click()}><FileImage size={16} /> Upload image</button>
        </div>
      </div>
    </div>
  )
}

/** Banner above the form: the image, what to check, and what could not be matched. */
export function ScanReview({ scan, onClear, kind, onScanned }: { scan: ScanState; onClear: () => void; kind: ScanKind; onScanned: (s: ScanState) => void }) {
  const [zoom, setZoom] = useState(false)
  const { result } = scan
  const matched = result.lines.filter((l) => l.productId).length
  return (
    <div className="card mb-4 overflow-hidden border-sky-200">
      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        <button className="group relative h-40 w-full shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 sm:h-36 sm:w-28" onClick={() => setZoom(true)} aria-label="View invoice image">
          {scan.isPdf ? (
            <span className="flex h-full items-center justify-center text-sm text-stone-500"><FileImage size={28} /></span>
          ) : (
            <img src={scan.previewUrl} alt="Scanned invoice" className="h-full w-full object-contain sm:object-cover sm:object-top" />
          )}
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-stone-900/60 py-1 text-xs text-white"><ZoomIn size={12} /> View</span>
        </button>
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-sky-900">Filled from the invoice image{scan.offline ? ' (read on this device)' : ''} — check before saving</p>
            <button className="btn-ghost -mt-1 -mr-2 text-stone-400" onClick={onClear} aria-label="Clear scanned data" title="Start again"><X size={16} /></button>
          </div>
          <p className="mt-0.5 text-stone-600">
            {result.lines.length} line(s) read · <span className={matched === result.lines.length ? 'text-brand-700' : 'font-medium text-amber-700'}>{matched} matched to products</span>
            {result.printedNetTotal != null && <> · image total Rs {result.printedNetTotal.toLocaleString('en-LK', { minimumFractionDigits: 2 })}</>}
          </p>
          {result.warnings.length ? (
            <ul className="mt-2 space-y-1">
              {result.warnings.map((w) => (
                <li key={w} className="flex gap-1.5 text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span>{w}</span></li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-brand-700"><CheckCircle2 size={14} /> Everything matched. Still compare quantities and prices with the image.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => setZoom(true)}><ZoomIn size={16} /> View image</button>
            <ScanUpload compact kind={kind} onScanned={onScanned} />
          </div>
        </div>
      </div>
      <Modal open={zoom} onClose={() => setZoom(false)} title="Invoice image" size="xl">
        {scan.isPdf ? (
          <iframe src={scan.previewUrl} title="Invoice PDF" className="h-[75vh] w-full rounded" />
        ) : (
          <div className="max-h-[75vh] overflow-auto"><img src={scan.previewUrl} alt="Scanned invoice" className="w-full" /></div>
        )}
      </Modal>
    </div>
  )
}
