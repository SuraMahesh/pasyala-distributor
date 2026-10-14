import { AlertTriangle, Eye, Gift, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import {
  invoiceTotals,
  lineNet,
  PAY_METHODS,
  qtyFmt,
  quotePrice,
  rs,
  todayLK,
  type PayMethod,
  type PricingContext,
} from '@pjd/shared'
import { useCustomerOptions, usePricingContext, useProductOptions, useSupplierOptions, type CustomerOption, type ProductOption } from '../lib/hooks'
import Combobox from './Combobox'
import { useConfirm } from './Confirm'
import PrintPreview from './PrintPreview'
import { Badge, Field, NumberInput } from './ui'

export interface DraftLine {
  key: string
  productId: number | null
  qty: number
  freeQty: number
  unitPrice: number
  discPct: number
  /** user typed price/discount — don't auto re-price */
  manualPrice?: boolean
  /** user typed free qty — don't auto apply promotions */
  manualFree?: boolean
  priceNote?: string
  /** line read from an invoice image — the text as printed, so the user can check / pick the product */
  imageText?: string
}

export interface Draft {
  partyId: number | null
  date: string
  payMethod: PayMethod
  billDiscPct: number
  paidOnInvoice: number
  paidTouched: boolean
  notes: string
  invoiceNo: string
  orderNo: string
  salesPerson: string
  lines: DraftLine[]
}

let seq = 0
const newKey = () => `l${++seq}-${Date.now()}`
export const blankLine = (): DraftLine => ({ key: newKey(), productId: null, qty: 1, freeQty: 0, unitPrice: 0, discPct: 0 })

export function emptyDraft(mode: 'sale' | 'purchase'): Draft {
  return {
    partyId: null,
    date: todayLK(),
    payMethod: 'Cash',
    billDiscPct: mode === 'purchase' ? 8 : 0,
    paidOnInvoice: 0,
    paidTouched: false,
    notes: '',
    invoiceNo: '',
    orderNo: '',
    salesPerson: '',
    lines: [blankLine()],
  }
}

function priceLine(l: DraftLine, p: ProductOption | undefined, cust: CustomerOption | undefined, ctx: PricingContext | undefined, date: string, mode: 'sale' | 'purchase'): DraftLine {
  if (!p) return l
  if (mode === 'purchase') {
    return l.manualPrice ? l : { ...l, unitPrice: p.listPrice, discPct: p.supplierDiscPct, priceNote: 'Supplier list price' }
  }
  if (!ctx) return l
  const q = quotePrice({ product: p, customer: cust ?? null, ...ctx, qty: l.qty, date })
  const next = { ...l }
  if (!l.manualPrice) {
    next.unitPrice = q.unitPrice
    next.discPct = q.discPct
    next.priceNote = q.sourceLabel
  }
  if (!l.manualFree) next.freeQty = q.freeQty
  return next
}

export default function InvoiceEditor({
  mode,
  initial,
  onSubmit,
  onCancel,
  submitting,
  ownQty,
  previousOutstanding = 0,
  invoiceNoPreview,
  renderPreview,
  scanned = false,
  printedTotal = null,
}: {
  mode: 'sale' | 'purchase'
  initial: Draft
  onSubmit: (d: Draft, paid: number) => Promise<unknown>
  onCancel: () => void
  submitting: boolean
  /** editing a sale: qty already on this invoice (comes back to stock first) */
  ownQty?: Map<number, number>
  /** editing a sale: what this invoice already added to the customer's balance */
  previousOutstanding?: number
  invoiceNoPreview?: string
  renderPreview: (d: Draft, paid: number) => ReactNode
  /** the draft was filled from an invoice image — ask the user to check it */
  scanned?: boolean
  /** net total printed on the scanned invoice, to compare with the lines */
  printedTotal?: number | null
}) {
  const confirm = useConfirm()
  const { data: products = [] } = useProductOptions()
  const { data: customers = [] } = useCustomerOptions()
  const { data: suppliers = [] } = useSupplierOptions()
  const { data: ctx } = usePricingContext()
  const [d, setD] = useState<Draft>(initial)
  const isEditing = !scanned && initial.lines.some((l) => l.productId)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState(false)
  const [done, setDone] = useState(false)
  const [initialJson] = useState(() => JSON.stringify(initial))
  const dirty = !done && JSON.stringify(d) !== initialJson

  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const customer = mode === 'sale' ? customers.find((c) => c.id === d.partyId) : undefined
  const partyList = mode === 'sale' ? customers.filter((c) => c.active || c.id === d.partyId) : suppliers.filter((s) => s.active || s.id === d.partyId)

  // leave-page guard
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    confirm({ title: 'Leave without saving?', message: 'Your changes to this invoice will be lost.', confirmText: 'Leave', cancelText: 'Stay', tone: 'danger' }).then((ok) =>
      ok ? blocker.proceed() : blocker.reset(),
    )
  }, [blocker, confirm])
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const validLines = d.lines.filter((l) => l.productId)
  const t = invoiceTotals(validLines, d.billDiscPct)
  const paid = d.paidTouched ? d.paidOnInvoice : d.payMethod === 'Credit' ? 0 : t.netTotal

  // stock check (sales)
  const requested = new Map<number, number>()
  validLines.forEach((l) => requested.set(l.productId!, (requested.get(l.productId!) ?? 0) + l.qty + l.freeQty))
  const available = (id: number) => (pmap.get(id)?.onHand ?? 0) + (ownQty?.get(id) ?? 0)
  const shortages = mode === 'sale' ? [...requested].filter(([id, q]) => q > available(id)) : []
  const billFactor = 1 - d.billDiscPct / 100
  const belowCost = mode === 'sale'
    ? validLines.filter((l) => {
        const p = pmap.get(l.productId!)
        return p && l.qty > 0 && (lineNet(l) * billFactor) / (l.qty + l.freeQty) + 0.005 < p.avgCost
      })
    : []
  const totalOff = printedTotal != null && validLines.length > 0 && Math.abs(t.netTotal - printedTotal) > 1
  const projected = customer ? customer.balance - previousOutstanding + (t.netTotal - paid) : 0
  const overLimit = mode === 'sale' && customer && customer.creditLimit > 0 && projected > customer.creditLimit

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const setLine = (key: string, patch: Partial<DraftLine>, reprice = false) =>
    setD((x) => ({
      ...x,
      lines: x.lines.map((l) => {
        if (l.key !== key) return l
        const next = { ...l, ...patch }
        return reprice ? priceLine(next, pmap.get(next.productId!), customers.find((c) => c.id === x.partyId), ctx, x.date, mode) : next
      }),
    }))

  // changing customer re-prices every line that was not typed by hand
  const chooseParty = (id: number) => {
    setD((x) => {
      const cust = customers.find((c) => c.id === id)
      // a new GRN starts with the bill discount from this supplier's last invoice (still editable)
      const lastBill = mode === 'purchase' && !isEditing ? suppliers.find((s) => s.id === id)?.lastBillDiscPct : null
      return { ...x, partyId: id, ...(lastBill != null ? { billDiscPct: lastBill } : {}), lines: mode === 'sale' ? x.lines.map((l) => priceLine(l, pmap.get(l.productId!), cust, ctx, x.date, mode)) : x.lines }
    })
    setErrors((e) => ({ ...e, party: '' }))
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!d.partyId) e.party = `Choose a ${mode === 'sale' ? 'customer' : 'supplier'}`
    if (mode === 'purchase' && !d.invoiceNo.trim()) e.invoiceNo = 'Enter the supplier invoice number'
    if (!validLines.length) e.lines = 'Add at least one item'
    d.lines.forEach((l, i) => {
      if (!l.productId && l.imageText) e[`line${l.key}`] = `Line ${i + 1}: choose the product for "${l.imageText}" or delete the line`
      if (l.productId && l.qty + l.freeQty <= 0) e[`line${l.key}`] = `Line ${i + 1}: qty must be more than 0`
      if (l.discPct < 0 || l.discPct > 100) e[`line${l.key}`] = `Line ${i + 1}: discount must be 0–100`
    })
    if (paid > t.netTotal + 0.004) e.paid = 'Paid now cannot be more than the net total'
    setErrors(e)
    return Object.values(e).filter(Boolean)
  }

  const save = async () => {
    const problems = validate()
    if (problems.length) {
      document.querySelector('[data-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const partyName = mode === 'sale' ? customer?.name : suppliers.find((s) => s.id === d.partyId)?.name
    const warnings = [
      ...(shortages.length ? [`Not enough stock for ${shortages.length} item(s) — the server will refuse unless negative stock is allowed in Settings.`] : []),
      ...(overLimit ? [`${customer!.name} will be over the credit limit (Rs ${rs(projected)} of Rs ${rs(customer!.creditLimit)}).`] : []),
      ...(belowCost.length ? [`${belowCost.length} item(s) priced below cost.`] : []),
      ...(totalOff ? [`Lines add up to Rs ${rs(t.netTotal)} but the image shows Rs ${rs(printedTotal!)}.`] : []),
    ]
    const ok = await confirm({
      title: isEditing ? 'Save changes to this invoice?' : scanned ? 'Save invoice read from image?'  : mode === 'sale' ? 'Create this sales invoice?' : 'Save this supplier invoice?',
      tone: warnings.length ? 'warning' : 'primary',
      confirmText: 'Save invoice',
      message: (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-stone-500">{mode === 'sale' ? 'Customer' : 'Supplier'}</dt><dd className="font-medium">{partyName}</dd>
          <dt className="text-stone-500">Items</dt><dd>{validLines.length} lines · {qtyFmt(t.units)} units{t.freeUnits ? ` + ${qtyFmt(t.freeUnits)} free` : ''}</dd>
          <dt className="text-stone-500">Net total</dt><dd className="font-semibold">Rs {rs(t.netTotal)}</dd>
          <dt className="text-stone-500">Paid now</dt><dd>Rs {rs(paid)} ({d.payMethod})</dd>
          <dt className="text-stone-500">Balance</dt><dd>Rs {rs(t.netTotal - paid)}</dd>
        </dl>
      ),
      details: warnings.length ? <ul className="list-disc space-y-1 pl-4 text-amber-800">{warnings.map((w) => <li key={w}>{w}</li>)}</ul> : undefined,
    })
    if (!ok) return
    try {
      setDone(true)
      await onSubmit({ ...d, lines: validLines }, paid)
    } catch {
      setDone(false)
    }
  }

  const productLabel = (p: ProductOption) => `${p.size} ${p.name}`

  return (
    <div className="space-y-4 pb-28 lg:pb-0">
      {/* header */}
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={mode === 'sale' ? 'Customer *' : 'Supplier *'} className="sm:col-span-2 lg:col-span-1" error={errors.party}>
          <div data-error={!!errors.party}>
            {mode === 'sale' ? (
              <Combobox
                items={partyList as CustomerOption[]}
                value={d.partyId}
                onChange={chooseParty}
                getId={(c) => c.id}
                getLabel={(c) => c.name}
                getSearch={(c) => `${c.code} ${c.name} ${c.area} ${c.typeName}`}
                placeholder="Search shop / customer…"
                renderItem={(c) => (
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-xs text-stone-500">{c.typeName}{c.area ? ` · ${c.area}` : ''}</span>
                    </span>
                    {c.balance > 0.004 && <Badge tone={c.overdue > 0 ? 'red' : 'amber'}>owes {rs(c.balance)}</Badge>}
                  </div>
                )}
              />
            ) : (
              <select className="input" value={d.partyId ?? ''} onChange={(e) => chooseParty(Number(e.target.value))}>
                <option value="">— select —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
          {customer && (
            <span className="mt-1 flex flex-wrap gap-1.5 text-xs">
              <Badge tone="blue">{customer.typeName}</Badge>
              {customer.discPct != null && <Badge>Own discount {customer.discPct}%</Badge>}
              {customer.balance > 0.004 && <Badge tone={customer.overdue > 0 ? 'red' : 'amber'}>Balance Rs {rs(customer.balance)}</Badge>}
              {customer.creditLimit > 0 && <Badge>Limit Rs {rs(customer.creditLimit)}</Badge>}
            </span>
          )}
        </Field>
        <Field label="Date">
          <input type="date" className="input" value={d.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field label="Payment method">
          <select className="input" value={d.payMethod} onChange={(e) => set({ payMethod: e.target.value as PayMethod })}>
            {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        {mode === 'purchase' ? (
          <>
            <Field label="Supplier invoice no *" error={errors.invoiceNo}>
              <input data-error={!!errors.invoiceNo} className="input uppercase" value={d.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value.toUpperCase() })} placeholder="HOSI00xxxx" />
            </Field>
            <Field label="Order no">
              <input className="input uppercase" value={d.orderNo} onChange={(e) => set({ orderNo: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Sales person">
              <input className="input" value={d.salesPerson} onChange={(e) => set({ salesPerson: e.target.value })} />
            </Field>
            <Field label="Notes">
              <input className="input" value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </>
        ) : (
          <Field label="Notes">
            <input className="input" value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional" />
          </Field>
        )}
      </div>

      {/* lines */}
      <div className="card">
        <div className="hidden grid-cols-[1.75rem_minmax(200px,1fr)_4.5rem_4.5rem_4rem_6.5rem_4.5rem_7rem_2.25rem] gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold tracking-wide text-stone-500 uppercase md:grid">
          <span>#</span><span>Item</span><span className="text-right">{mode === 'sale' ? 'Stock' : ''}</span><span className="text-right">Qty</span><span className="text-right">Free</span><span className="text-right">Unit price</span><span className="text-right">Disc %</span><span className="text-right">Amount</span><span />
        </div>
        <ul className="divide-y divide-stone-100">
          {d.lines.map((l, i) => {
            const p = l.productId ? pmap.get(l.productId) : undefined
            const avail = l.productId ? available(l.productId) : 0
            const short = mode === 'sale' && !!l.productId && (requested.get(l.productId) ?? 0) > avail
            const below = belowCost.includes(l)
            const err = errors[`line${l.key}`]
            return (
              <li key={l.key} className="px-3 py-3 md:py-2" data-error={!!err}>
                <div className="grid grid-cols-4 items-start gap-2 md:grid-cols-[1.75rem_minmax(200px,1fr)_4.5rem_4.5rem_4rem_6.5rem_4.5rem_7rem_2.25rem] md:items-center">
                  <span className="hidden text-sm text-stone-400 md:block">{i + 1}</span>
                  <div className="col-span-3 md:col-span-1">
                    <Combobox
                      items={products.filter((x) => x.active || x.id === l.productId)}
                      value={l.productId}
                      onChange={(id) => setLine(l.key, l.imageText ? { productId: id } : { productId: id, manualPrice: false, manualFree: false }, true)}
                      getId={(x) => x.id}
                      getLabel={productLabel}
                      getSearch={(x) => `${x.code} ${x.size} ${x.name}`}
                      placeholder="Search code or name…"
                      autoFocus={i > 0 && i === d.lines.length - 1 && !l.productId && !l.imageText}
                      renderItem={(x) => (
                        <div className="flex items-center justify-between gap-3">
                          <span className="min-w-0 truncate"><span className="font-medium">{productLabel(x)}</span> <span className="text-xs text-stone-400">{x.code}</span></span>
                          <span className={`shrink-0 text-xs tabular-nums ${x.onHand <= 0 ? 'text-red-600' : 'text-stone-500'}`}>{x.onHand} in stock</span>
                        </div>
                      )}
                    />
                  </div>
                  <div className="flex justify-end md:contents">
                    <button className="btn-ghost text-stone-400 hover:text-red-600 md:order-last" onClick={() => setD((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((y) => y.key !== l.key) : [blankLine()] }))} aria-label="Remove line">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <span className={`hidden text-right text-sm tabular-nums md:block ${short ? 'font-semibold text-red-600' : 'text-stone-500'}`}>{mode === 'sale' && l.productId ? avail : ''}</span>
                  <MobileLabel label="Qty"><NumberInput aria-label="Qty" min={0} step={1} className="py-1.5" value={l.qty} onChange={(v) => setLine(l.key, { qty: Math.max(0, Math.round(v ?? 0)) }, true)} /></MobileLabel>
                  <MobileLabel label="Free"><NumberInput aria-label="Free qty" min={0} step={1} className="py-1.5" value={l.freeQty} onChange={(v) => setLine(l.key, { freeQty: Math.max(0, Math.round(v ?? 0)), manualFree: true })} /></MobileLabel>
                  <MobileLabel label="Price"><NumberInput aria-label="Unit price" min={0} step="0.01" className="py-1.5" value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v ?? 0, manualPrice: true, priceNote: 'Typed price' })} /></MobileLabel>
                  <MobileLabel label="Disc %"><NumberInput aria-label="Discount %" min={0} max={100} step="0.01" className="py-1.5" value={l.discPct} onChange={(v) => setLine(l.key, { discPct: v ?? 0, manualPrice: true, priceNote: 'Typed discount' })} /></MobileLabel>
                  <div className="col-span-4 flex items-center justify-between md:col-span-1 md:block md:text-right">
                    <span className="text-xs text-stone-500 md:hidden">Amount</span>
                    <span className="font-semibold tabular-nums">{rs(lineNet(l))}</span>
                  </div>
                </div>
                {(p || err || l.imageText) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 md:pl-9">
                    {p && <span className="font-mono">{p.code}</span>}
                    {mode === 'sale' && p && <span className={`md:hidden ${short ? 'font-semibold text-red-600' : ''}`}>Stock {avail}</span>}
                    {l.imageText && <span className={l.productId ? 'text-sky-700' : 'font-medium text-amber-700'}>{l.productId ? 'Image:' : 'Not matched — image says:'} “{l.imageText}”</span>}
                    {l.priceNote && <span>{l.priceNote}</span>}
                    {l.freeQty > 0 && !l.manualFree && mode === 'sale' && <span className="inline-flex items-center gap-1 text-brand-700"><Gift size={12} /> promotion</span>}
                    {short && <span className="font-medium text-red-600">only {avail} in stock</span>}
                    {below && <span className="font-medium text-amber-700">below cost (Rs {rs(p!.avgCost)})</span>}
                    {err && <span className="font-medium text-red-600">{err}</span>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 p-3">
          <button className="btn-secondary" onClick={() => setD((x) => ({ ...x, lines: [...x.lines, blankLine()] }))}>
            <Plus size={16} /> Add item
          </button>
          {errors.lines && <span className="text-sm font-medium text-red-600" data-error="true">{errors.lines}</span>}
        </div>
      </div>

      {/* totals + warnings */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {shortages.length > 0 && (
            <Warn>
              Not enough stock for: {shortages.map(([id]) => `${pmap.get(id)?.size} ${pmap.get(id)?.name} (have ${available(id)})`).join(', ')}.
            </Warn>
          )}
          {overLimit && <Warn>{customer!.name} will owe Rs {rs(projected)}, over the credit limit of Rs {rs(customer!.creditLimit)}.</Warn>}
          {belowCost.length > 0 && <Warn>{belowCost.length} item(s) are priced below what you paid for them.</Warn>}
          {totalOff && <Warn>Lines add up to Rs {rs(t.netTotal)} but the invoice image shows Rs {rs(printedTotal!)} — check qty, prices and discounts.</Warn>}
          {printedTotal != null && !totalOff && validLines.length > 0 && <p className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800">✓ Net total matches the invoice image (Rs {rs(printedTotal)}).</p>}
        </div>
        <div className="card hidden space-y-2 p-4 text-sm lg:block">
          <Totals t={t} d={d} paid={paid} set={set} paidError={errors.paid} />
          <div className="flex gap-2 pt-2">
            <button className="btn-secondary flex-1" onClick={onCancel} disabled={submitting}>Cancel</button>
            <button className="btn-primary flex-1" onClick={save} disabled={submitting}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
            </button>
          </div>
          <button className="btn-secondary w-full" onClick={() => setPreview(true)}><Eye size={16} /> Preview / print draft</button>
        </div>
      </div>

      {/* phones & tablets: sticky totals bar */}
      <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] lg:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-sm">
            <span className="text-stone-500">{validLines.length} items · tap for totals</span>
            <span className="text-lg font-semibold tabular-nums">Rs {rs(t.netTotal)}</span>
          </summary>
          <div className="space-y-2 border-t border-stone-100 py-2 text-sm">
            <Totals t={t} d={d} paid={paid} set={set} paidError={errors.paid} />
          </div>
        </details>
        <div className="mt-2 grid grid-cols-[auto_1fr_1fr] gap-2">
          <button className="btn-secondary" onClick={() => setPreview(true)} aria-label="Preview"><Eye size={16} /></button>
          <button className="btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={submitting}>
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
          </button>
        </div>
      </div>

      <PrintPreview open={preview} onClose={() => setPreview(false)} title={invoiceNoPreview ?? 'Draft'}>
        {renderPreview({ ...d, lines: validLines }, paid)}
      </PrintPreview>
    </div>
  )
}

function MobileLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-stone-500 md:hidden">{label}</span>
      {children}
    </label>
  )
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

function Totals({ t, d, paid, set, paidError }: { t: ReturnType<typeof invoiceTotals>; d: Draft; paid: number; set: (p: Partial<Draft>) => void; paidError?: string }) {
  return (
    <>
      <Row label="Gross">{rs(t.gross)}</Row>
      <Row label="Line discounts">− {rs(t.lineDiscount)}</Row>
      <Row label="Sub total" strong>{rs(t.subTotal)}</Row>
      <div className="flex items-center justify-between gap-3">
        <span className="text-stone-500">Bill discount %</span>
        <NumberInput aria-label="Bill discount %" min={0} max={100} step="0.01" className="w-24 py-1" value={d.billDiscPct} onChange={(v) => set({ billDiscPct: Math.min(100, Math.max(0, v ?? 0)) })} />
      </div>
      <Row label="Bill discount">− {rs(t.billDiscount)}</Row>
      <div className="border-t border-stone-200 pt-2">
        <Row label="Net total" strong big>{rs(t.netTotal)}</Row>
      </div>
      <div className="flex items-center justify-between gap-3" data-error={!!paidError}>
        <span className="text-stone-500">Paid now</span>
        <NumberInput aria-label="Paid now" min={0} step="0.01" className="w-36 py-1" value={paid} onChange={(v) => set({ paidOnInvoice: v ?? 0, paidTouched: true })} />
      </div>
      {paidError && <p className="text-xs text-red-600">{paidError}</p>}
      <Row label="Balance due">{rs(t.netTotal - paid)}</Row>
      <p className="text-xs text-stone-400">{t.units} units + {t.freeUnits} free</p>
    </>
  )
}

function Row({ label, children, strong, big }: { label: string; children: ReactNode; strong?: boolean; big?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? 'font-medium text-stone-800' : 'text-stone-500'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-semibold text-stone-900' : ''} ${big ? 'text-lg' : ''}`}>{children}</span>
    </div>
  )
}
