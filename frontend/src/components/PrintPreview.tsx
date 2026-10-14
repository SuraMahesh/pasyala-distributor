import { Minus, Plus, Printer, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Paper = 'A4' | 'A5' | 'Letter'

const PAPER: Record<Paper, { w: number; h: number; css: string }> = {
  // mm
  A4: { w: 210, h: 297, css: 'A4' },
  A5: { w: 148, h: 210, css: 'A5' },
  Letter: { w: 216, h: 279, css: 'letter' },
}
const MM = 3.7795 // px per mm at 96dpi

/**
 * Full-screen print preview. Shows the document on a paper-sized sheet,
 * lets the user pick paper size, orientation and zoom, then prints only the sheet.
 */
export default function PrintPreview({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const [paper, setPaper] = useState<Paper>(() => (localStorage.getItem('pp-paper') as Paper) || 'A4')
  const [landscape, setLandscape] = useState(false)
  const [zoom, setZoom] = useState(0.9)

  useEffect(() => {
    try { localStorage.setItem('pp-paper', paper) } catch { /* ignore */ }
  }, [paper])

  useEffect(() => {
    if (!open) return
    document.body.classList.add('preview-open')
    const prevTitle = document.title
    document.title = title // used as the default PDF file name
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        window.print()
      }
    }
    window.addEventListener('keydown', h)
    return () => {
      document.body.classList.remove('preview-open')
      document.title = prevTitle
      window.removeEventListener('keydown', h)
    }
  }, [open, onClose, title])

  if (!open) return null
  const p = PAPER[paper]
  const w = (landscape ? p.h : p.w) * MM
  const h = (landscape ? p.w : p.h) * MM
  const small = paper === 'A5' && !landscape

  return createPortal(
    <div className="print-preview fixed inset-0 z-[60] flex flex-col bg-stone-700">
      <style>{`@page { size: ${p.css} ${landscape ? 'landscape' : 'portrait'}; margin: 0; }`}</style>

      <div className="pp-toolbar flex flex-wrap items-center gap-2 border-b border-stone-800 bg-stone-900 px-4 py-2 text-sm text-stone-100">
        <span className="mr-auto font-medium">Print preview · {title}</span>
        <select className="rounded-md bg-stone-800 px-2 py-1.5" value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
          {Object.keys(PAPER).map((k) => <option key={k}>{k}</option>)}
        </select>
        <select className="rounded-md bg-stone-800 px-2 py-1.5" value={landscape ? 'l' : 'p'} onChange={(e) => setLandscape(e.target.value === 'l')}>
          <option value="p">Portrait</option>
          <option value="l">Landscape</option>
        </select>
        <div className="flex items-center rounded-md bg-stone-800">
          <button className="px-2 py-1.5 hover:text-white" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))} aria-label="Zoom out"><Minus size={14} /></button>
          <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button className="px-2 py-1.5 hover:text-white" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)))} aria-label="Zoom in"><Plus size={14} /></button>
        </div>
        <button className="btn bg-brand-600 text-white hover:bg-brand-500" onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</button>
        <button className="btn text-stone-300 hover:bg-stone-800 hover:text-white" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <div className="pp-scroll flex-1 overflow-auto p-6">
        <div className="mx-auto" style={{ width: w * zoom, height: h * zoom }}>
          <div
            className={`pp-sheet bg-white shadow-2xl ${small ? 'pp-small' : ''}`}
            style={{ width: w, minHeight: h, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
