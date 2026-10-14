import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ChevronLeft, ChevronRight, Download, ImagePlus, Images, Loader2, RotateCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react'
import { toast } from 'sonner'
import type { ImageInvoiceKind, InvoiceImage } from '@pjd/shared'
import { api } from '../lib/api'
import { errorMessage } from '../lib/hooks'
import { imageUrl, listPhotos, preparePhoto, rotatedSrc, uploadPhoto, type PreparedPhoto } from '../lib/images'
import { useConfirm } from './Confirm'

/** Photos of the paper invoice, shown on the invoice page. */
export default function InvoiceImages({ kind, invoiceId, invoiceNo, partyName }: { kind: ImageInvoiceKind; invoiceId: number; invoiceNo: string; partyName: string }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const key = ['invoice-images', kind, invoiceId]
  const q = useQuery({ queryKey: key, queryFn: () => listPhotos(kind, invoiceId) })
  const status = useQuery({ queryKey: ['images-status'], queryFn: () => api.get<{ ready: boolean; kind: 'blob' | 'local' }>('/images/status'), staleTime: 10 * 60_000 })
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const list = q.data ?? []

  const add = async (files: FileList | null) => {
    const chosen = [...(files ?? [])]
    if (pick.current) pick.current.value = ''
    if (camera.current) camera.current.value = ''
    if (!chosen.length || busy) return
    setBusy(true)
    const prepared: PreparedPhoto[] = []
    try {
      for (const f of chosen) prepared.push(await preparePhoto(f))
    } catch (e) {
      toast.error(errorMessage(e))
      setBusy(false)
      return
    }
    // the person checks the paper matches THIS invoice before it is attached
    const ok = await confirm({
      title: `Attach to ${invoiceNo}?`,
      tone: 'warning',
      confirmText: prepared.length > 1 ? `Attach ${prepared.length} photos` : 'Attach photo',
      message: (
        <span>
          Check the invoice number on the paper is <b>{invoiceNo}</b>
          {partyName ? <> ({partyName})</> : null}. A photo can belong to one invoice only.
        </span>
      ),
      details: (
        <div className="flex gap-2 overflow-x-auto">
          {prepared.map((p) => <img key={p.sha256} src={p.previewUrl} alt="" className="h-40 rounded border border-stone-200 object-contain" />)}
        </div>
      ),
    })
    if (!ok) {
      setBusy(false)
      return
    }
    let added = 0
    for (const p of prepared) {
      try {
        await uploadPhoto(kind, invoiceId, p)
        added++
      } catch (e) {
        toast.error(errorMessage(e), { duration: 10000 })
      }
    }
    if (added) toast.success(`${added} photo${added > 1 ? 's' : ''} attached to ${invoiceNo}`)
    await qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: [kind === 'sale' ? 'sales' : 'purchases'] })
    qc.invalidateQueries({ queryKey: ['gallery'] })
    setBusy(false)
  }

  const notReady = status.data && !status.data.ready

  return (
    <section className="no-print card mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Images size={18} className="text-stone-500" /> Invoice photos
          <span className="text-sm font-normal text-stone-500">{list.length ? `${list.length} page${list.length > 1 ? 's' : ''}` : 'none yet'}</span>
        </h2>
        <div className="flex gap-2">
          <input ref={pick} type="file" accept="image/*" multiple className="hidden" onChange={(e) => add(e.target.files)} />
          <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => add(e.target.files)} />
          <button className="btn-primary sm:hidden" disabled={busy || !!notReady} onClick={() => camera.current?.click()}><Camera size={16} /> Take photo</button>
          <button className="btn-secondary" disabled={busy || !!notReady} onClick={() => pick.current?.click()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />} Add photo
          </button>
        </div>
      </div>
      {notReady ? (
        <p className="p-4 text-sm text-amber-800">Photo storage is not set up yet. In Vercel open <b>Storage → Create → Blob</b> (choose Private), connect it to this project and redeploy.</p>
      ) : list.length ? (
        <ul className="flex gap-3 overflow-x-auto p-4">
          {list.map((img, i) => (
            <li key={img.id} className="shrink-0">
              <button className="group relative block h-36 w-28 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 hover:ring-2 hover:ring-brand-400" onClick={() => setOpen(i)} aria-label={`Open page ${img.page}`}>
                <PhotoImg imageId={img.id} rotation={img.rotation} thumb alt={`${invoiceNo} page ${img.page}`} loading="lazy" className="h-full w-full object-cover object-top" />
                <span className="absolute inset-x-0 bottom-0 bg-stone-900/60 py-0.5 text-center text-xs text-white">Page {img.page}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-stone-500">No photo of the paper invoice yet. Add one so it is always easy to check against this record.</p>
      )}
      {open != null && list[open] && (
        <Lightbox
          images={list}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onRotated={() => qc.invalidateQueries({ queryKey: key })}
          onDelete={async (img) => {
            if (!(await confirm({ title: `Remove page ${img.page} of ${invoiceNo}?`, message: 'The photo is deleted. The invoice itself does not change.', tone: 'danger', confirmText: 'Remove photo' }))) return
            try {
              await api.del(`/images/${img.id}`)
              toast.success('Photo removed')
              setOpen(null)
              await qc.invalidateQueries({ queryKey: key })
              qc.invalidateQueries({ queryKey: [kind === 'sale' ? 'sales' : 'purchases'] })
              qc.invalidateQueries({ queryKey: ['gallery'] })
            } catch (e) {
              toast.error(errorMessage(e))
            }
          }}
        />
      )}
    </section>
  )
}

/** Full-screen viewer: next / previous page, zoom, download. */
export function Lightbox({ images, index, onIndex, onClose, onDelete, onRotated, title }: {
  images: InvoiceImage[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onDelete?: (img: InvoiceImage) => void
  onRotated?: () => void
  title?: (img: InvoiceImage) => string
}) {
  const img = images[index]
  const [zoom, setZoom] = useState(false)
  // turn is saved, so the photo shows upright everywhere next time
  const [turn, setTurn] = useState<Record<number, number>>({})
  const rotation = turn[img.id] ?? img.rotation
  const rotate = async () => {
    const next = (rotation + 90) % 360
    setTurn((t) => ({ ...t, [img.id]: next }))
    try {
      await api.send('PATCH', `/images/${img.id}`, { rotation: next })
      onRotated?.()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  useEffect(() => setZoom(false), [index])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [index, images.length, onClose, onIndex])
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-950/95 text-white" role="dialog" aria-modal="true">
      <div className="flex items-center gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title ? title(img) : `${img.invoiceNo} · page ${img.page} of ${images.length}`}</p>
        <button className="rounded-lg p-2 hover:bg-white/10" onClick={rotate} aria-label="Rotate" title="Turn the photo (saved)"><RotateCw size={20} /></button>
        <a className="rounded-lg p-2 hover:bg-white/10" href={imageUrl(img.id, { download: true })} aria-label="Download" title="Download"><Download size={20} /></a>
        {onDelete && <button className="rounded-lg p-2 text-red-300 hover:bg-white/10" onClick={() => onDelete(img)} aria-label="Remove photo" title="Remove photo"><Trash2 size={20} /></button>}
        <button className="rounded-lg p-2 hover:bg-white/10" onClick={onClose} aria-label="Close"><X size={22} /></button>
      </div>
      <div className={`relative min-h-0 flex-1 ${zoom ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden'}`} onClick={() => setZoom((z) => !z)}>
        <PhotoImg imageId={img.id} rotation={rotation} alt={`${img.invoiceNo} page ${img.page}`} className={zoom ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'} style={zoom ? { width: `${Math.max(rotation % 180 ? img.height : img.width, 1600)}px` } : undefined} />
      </div>
      {images.length > 1 && (
        <div className="flex items-center justify-center gap-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="Previous page"><ChevronLeft size={26} /></button>
          <span className="text-sm tabular-nums">{index + 1} / {images.length}</span>
          <button className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30" disabled={index === images.length - 1} onClick={() => onIndex(index + 1)} aria-label="Next page"><ChevronRight size={26} /></button>
        </div>
      )}
    </div>
  )
}

/** An invoice photo, turned upright. */
export function PhotoImg({ imageId, rotation, thumb, ...rest }: { imageId: number; rotation: number; thumb?: boolean } & ImgHTMLAttributes<HTMLImageElement>) {
  const url = imageUrl(imageId, { thumb })
  const [src, setSrc] = useState(rotation ? '' : url)
  useEffect(() => {
    let live = true
    rotatedSrc(url, rotation).then((u) => live && setSrc(u), () => live && setSrc(url))
    return () => {
      live = false
    }
  }, [url, rotation])
  return src ? <img src={src} {...rest} /> : <span className={`block animate-pulse bg-stone-200 ${rest.className ?? ''}`} />
}
