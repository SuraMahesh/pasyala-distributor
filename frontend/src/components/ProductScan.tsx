import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, FileImage, Loader2, ScanLine } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CATEGORIES, codeShape, guessCategory, parseInvoiceText, rs, sizeKey, type Category, type ProductWithStock } from '@pjd/shared'
import { api, fetchAll } from '../lib/api'
import { errorMessage } from '../lib/hooks'
import { readDocument } from '../lib/readDoc'
import { useConfirm } from './Confirm'
import { Badge, Modal, NumberInput } from './ui'

interface NewRow {
  key: string
  on: boolean
  code: string
  name: string
  size: string
  category: Category
  listPrice: number
  supplierDiscPct: number
  sellPrice: number
  raw: string
}
interface PriceRow {
  key: string
  on: boolean
  product: ProductWithStock
  listPrice: number
  supplierDiscPct: number
  alsoSell: boolean
}

/** "30ML" / "1KG" from the reader → the way sizes are written in the catalogue (30ML, 1kg, 50g, 4.5L) */
const niceSize = (s: string) => {
  const k = sizeKey(s)
  const m = k.match(/^([\d.]+)(ML|KG|L|G)$/)
  if (!m) return s
  return m[2] === 'KG' ? `${m[1]}kg` : m[2] === 'G' ? `${m[1]}g` : `${m[1]}${m[2]}`
}
const niceCode = (c: string) => {
  const w = c.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  const m = w.match(/^([A-Z]{2,5}-?[A-Z]?)([0-9OILSB]{3,5})$/)
  return m ? m[1] + m[2].replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8') : ''
}
const cleanName = (s: string) => s.toUpperCase().replace(/[^A-Z/ ]/g, ' ').replace(/\b[A-Z]\b/g, ' ').replace(/\s+/g, ' ').trim()

/** Products → Scan: read a supplier price list / invoice (photo or PDF) and add new products / update prices. */
export default function ProductScan({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const pick = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [source, setSource] = useState<{ name: string; preview: string; exact: boolean } | null>(null)
  const [news, setNews] = useState<NewRow[]>([])
  const [prices, setPrices] = useState<PriceRow[]>([])
  const [same, setSame] = useState(0)
  const [saving, setSaving] = useState(false)

  const read = async (file: File | undefined) => {
    if (!file) return
    setBusy('Reading…')
    try {
      const doc = await readDocument(file, setBusy)
      setBusy('Matching products…')
      const all = await fetchAll<ProductWithStock>('/products', {})
      const catalog = all.map(({ id, code, name, size, listPrice, supplierDiscPct }) => ({ id, code, name, size, listPrice, supplierDiscPct }))
      const raw = parseInvoiceText(doc.text, 'purchase', catalog)
      const byId = new Map(all.map((p) => [p.id, p]))
      const n: NewRow[] = []
      const pr = new Map<number, PriceRow>()
      let unchanged = 0
      for (const [i, l] of (raw.lines ?? []).entries()) {
        const price = l.unitPrice ?? 0
        if (l.productId && byId.has(l.productId)) {
          const p = byId.get(l.productId)!
          if (price <= 0 || pr.has(p.id)) continue // free-issue lines carry no price
          const disc = l.discPct ?? p.supplierDiscPct
          if (Math.abs(price - p.listPrice) < 0.005 && Math.abs(disc - p.supplierDiscPct) < 0.005) unchanged++
          else pr.set(p.id, { key: `p${p.id}`, on: true, product: p, listPrice: price, supplierDiscPct: disc, alsoSell: p.sellPrice === p.listPrice })
          continue
        }
        const name = cleanName(l.description ?? '')
        const size = niceSize(l.size ?? '')
        if (!name || name.length < 3) continue
        const code = niceCode(l.code ?? '')
        if (n.some((x) => (code && codeShape(x.code) === codeShape(code)) || (x.name === name && x.size === size))) continue
        n.push({
          key: `n${i}`,
          on: price > 0,
          code,
          name,
          size,
          category: guessCategory(code, name, all),
          listPrice: price,
          supplierDiscPct: l.discPct ?? 22,
          sellPrice: price,
          raw: [l.code, l.size, l.description].filter(Boolean).join(' '),
        })
      }
      setNews(n)
      setPrices([...pr.values()])
      setSame(unchanged)
      setSource({ name: file.name, preview: doc.previewUrl, exact: doc.exactText })
      if (!n.length && !pr.size) toast.info(unchanged ? `All ${unchanged} products on this document already have these prices.` : 'No product lines were found. Try a sharper photo, or a PDF.')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy('')
      if (pick.current) pick.current.value = ''
    }
  }

  const chosenNew = news.filter((r) => r.on)
  const chosenPrice = prices.filter((r) => r.on)
  const problems = chosenNew.filter((r) => !r.name.trim() || !r.size.trim() || r.listPrice < 0)
  const canSave = (chosenNew.length || chosenPrice.length) && !problems.length

  const save = async () => {
    const ok = await confirm({
      title: 'Save these product changes?',
      confirmText: 'Save',
      message: (
        <ul className="list-disc space-y-1 pl-4">
          {chosenNew.length > 0 && <li><b>{chosenNew.length}</b> new product(s) will be added (stock starts at 0 — it comes in with a purchase invoice).</li>}
          {chosenPrice.length > 0 && <li><b>{chosenPrice.length}</b> product price(s) will change. Invoices already saved do not change.</li>}
        </ul>
      ),
    })
    if (!ok) return
    setSaving(true)
    try {
      const r = await api.post<{ created: { code: string }[]; updated: number }>('/products/import', {
        create: chosenNew.map((x) => ({ code: x.code, name: x.name, size: x.size, category: x.category, listPrice: x.listPrice, supplierDiscPct: x.supplierDiscPct, sellPrice: x.sellPrice, reorderLevel: 5, openingStock: 0, active: true })),
        update: chosenPrice.map((x) => ({ id: x.product.id, listPrice: x.listPrice, supplierDiscPct: x.supplierDiscPct, ...(x.alsoSell ? { sellPrice: x.listPrice } : {}) })),
      })
      toast.success([r.created.length && `${r.created.length} product(s) added`, r.updated && `${r.updated} price(s) updated`].filter(Boolean).join(' · ') || 'Nothing changed')
      await qc.invalidateQueries()
      onClose()
    } catch (e) {
      toast.error(errorMessage(e), { duration: 10000 })
    } finally {
      setSaving(false)
    }
  }

  const setNew = (key: string, patch: Partial<NewRow>) => setNews((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const setPrice = (key: string, patch: Partial<PriceRow>) => setPrices((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const summary = useMemo(() => `${news.length} new · ${prices.length} price change(s) · ${same} unchanged`, [news.length, prices.length, same])

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Scan a price list or supplier invoice"
      footer={
        source ? (
          <>
            <button className="btn-secondary sm:mr-auto" onClick={() => pick.current?.click()} disabled={!!busy || saving}><ScanLine size={16} /> Scan another</button>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!canSave || saving} onClick={save}>{saving && <Loader2 size={16} className="animate-spin" />} Save {chosenNew.length + chosenPrice.length || ''} change(s)</button>
          </>
        ) : undefined
      }
    >
      <input ref={pick} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={(e) => read(e.target.files?.[0])} />
      {busy ? (
        <div className="flex flex-col items-center gap-3 py-12 text-stone-600"><Loader2 size={28} className="animate-spin text-brand-700" /><p>{busy}</p></div>
      ) : !source ? (
        <div className="space-y-4 py-4 text-sm text-stone-600">
          <p>Upload a supplier <b>price list</b> or <b>invoice</b> (photo or PDF). Every line is read and matched to your products:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>New products</b> — not in your list yet. Check the name, size and category, then add them.</li>
            <li><b>Price changes</b> — products you have, with a new supplier price or discount.</li>
          </ul>
          <p>Nothing is saved until you review the list and press Save.</p>
          <button className="btn-primary" onClick={() => pick.current?.click()}><FileImage size={16} /> Choose photo or PDF</button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3 text-sm">
            <img src={source.preview} alt="" className="h-16 w-12 rounded border border-stone-200 object-cover object-top" />
            <div className="min-w-0">
              <p className="truncate font-medium">{source.name}</p>
              <p className="text-stone-500">{summary} · {source.exact ? 'text read exactly from the PDF' : 'read from the image — check every value'}</p>
            </div>
          </div>

          <section>
            <h3 className="mb-2 font-semibold">New products <Badge>{news.length}</Badge></h3>
            {news.length ? (
              <div className="overflow-x-auto rounded-lg border border-stone-200">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                    <tr><th className="w-8 px-2 py-2" /><th className="px-2 py-2 text-left">Name</th><th className="px-2 py-2 text-left">Size</th><th className="px-2 py-2 text-left">Category</th><th className="px-2 py-2 text-left">Stock code</th><th className="px-2 py-2 text-right">Unit price</th><th className="px-2 py-2 text-right">Disc %</th><th className="px-2 py-2 text-right">Sell price</th></tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {news.map((r) => (
                      <tr key={r.key} className={r.on ? '' : 'opacity-50'}>
                        <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={r.on} onChange={(e) => setNew(r.key, { on: e.target.checked })} aria-label={`Add ${r.name}`} /></td>
                        <td className="px-2 py-1.5"><input className="input py-1 uppercase" value={r.name} onChange={(e) => setNew(r.key, { name: e.target.value.toUpperCase() })} /><span className="mt-0.5 block truncate text-[11px] text-stone-400" title={r.raw}>read: {r.raw}</span></td>
                        <td className="px-2 py-1.5"><input className="input w-20 py-1" value={r.size} onChange={(e) => setNew(r.key, { size: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><select className="input py-1" value={r.category} onChange={(e) => setNew(r.key, { category: e.target.value as Category })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></td>
                        <td className="px-2 py-1.5"><input className="input w-28 py-1 font-mono uppercase" placeholder="auto" value={r.code} onChange={(e) => setNew(r.key, { code: e.target.value.toUpperCase() })} /></td>
                        <td className="px-2 py-1.5"><NumberInput className="w-24 py-1" min={0} step="0.01" value={r.listPrice} onChange={(v) => setNew(r.key, { listPrice: v ?? 0, sellPrice: r.sellPrice === r.listPrice ? v ?? 0 : r.sellPrice })} /></td>
                        <td className="px-2 py-1.5"><NumberInput className="w-16 py-1" min={0} max={100} value={r.supplierDiscPct} onChange={(v) => setNew(r.key, { supplierDiscPct: v ?? 0 })} /></td>
                        <td className="px-2 py-1.5"><NumberInput className="w-24 py-1" min={0} step="0.01" value={r.sellPrice} onChange={(v) => setNew(r.key, { sellPrice: v ?? 0 })} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-stone-500">None — every product on the document is already in your list.</p>}
          </section>

          <section>
            <h3 className="mb-2 font-semibold">Price changes <Badge>{prices.length}</Badge>{same > 0 && <span className="ml-2 text-sm font-normal text-stone-500">{same} product(s) already have these prices</span>}</h3>
            {prices.length ? (
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 text-sm">
                {prices.map((r) => (
                  <li key={r.key} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 ${r.on ? '' : 'opacity-50'}`}>
                    <input type="checkbox" checked={r.on} onChange={(e) => setPrice(r.key, { on: e.target.checked })} aria-label={`Update ${r.product.name}`} />
                    <span className="min-w-[12rem] flex-1"><span className="text-stone-500">{r.product.size}</span> <span className="font-medium">{r.product.name}</span> <span className="font-mono text-xs text-stone-400">{r.product.code}</span></span>
                    <span className="flex items-center gap-2 tabular-nums">
                      <span className="text-stone-500">{rs(r.product.listPrice)} · {r.product.supplierDiscPct}%</span>
                      <ArrowRight size={14} className="text-stone-400" />
                      <NumberInput className="w-24 py-1" min={0} step="0.01" value={r.listPrice} onChange={(v) => setPrice(r.key, { listPrice: v ?? 0 })} aria-label="New unit price" />
                      <NumberInput className="w-16 py-1" min={0} max={100} value={r.supplierDiscPct} onChange={(v) => setPrice(r.key, { supplierDiscPct: v ?? 0 })} aria-label="New discount %" />
                    </span>
                    <label className="flex items-center gap-1.5 text-xs text-stone-600"><input type="checkbox" checked={r.alsoSell} onChange={(e) => setPrice(r.key, { alsoSell: e.target.checked })} /> also set selling price (now {rs(r.product.sellPrice)})</label>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-stone-500">No price changes.</p>}
          </section>
          {problems.length > 0 && <p className="text-sm font-medium text-red-600">Fill in the name and size for every ticked new product.</p>}
        </div>
      )}
    </Modal>
  )
}
