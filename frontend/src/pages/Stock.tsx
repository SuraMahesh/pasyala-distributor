import { FileSpreadsheet, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ADJ_REASONS, rs, todayLK, type AdjReason, type ProductWithStock } from '@pjd/shared'
import Combobox from '../components/Combobox'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column } from '../components/DataTable'
import { Badge, Field, Filters, Modal, NumberInput, PageHeader, SearchBox, Stat, StockBadge, Tabs } from '../components/ui'
import { api, fetchAll } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { useApiMutation, useListState, usePaged, useProductOptions } from '../lib/hooks'
import { useProductMeta } from './Products'

interface AdjRow {
  id: number
  date: string
  productId: number
  productLabel: string
  productCode: string
  qty: number
  reason: string
  notes: string
}

export default function Stock() {
  const [s, set] = useListState({ tab: 'stock', stock: '', size: '', status: 'active', sort: 'name', dir: 'asc' as const })
  const [adjOpen, setAdjOpen] = useState(false)
  return (
    <div>
      <PageHeader
        title="Stock"
        subtitle="On hand = opening + purchases (incl. free) − sales (incl. free) ± adjustments"
        actions={<button className="btn-primary" onClick={() => setAdjOpen(true)}><SlidersHorizontal size={16} /> Adjust stock</button>}
      />
      <Tabs value={s.tab} onChange={(t) => set({ tab: t, sort: t === 'stock' ? 'name' : 'date', dir: t === 'stock' ? 'asc' : 'desc' })} tabs={[{ key: 'stock', label: 'Stock on hand' }, { key: 'adjustments', label: 'Adjustments' }]} />
      {s.tab === 'stock' ? <StockTable s={s} set={set} /> : <Adjustments s={s} set={set} />}
      {adjOpen && <AdjustModal onClose={() => setAdjOpen(false)} />}
    </div>
  )
}

const n = (v: number | undefined | null) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const freeQty = (p: ProductWithStock) => n(p.freeOnHand)
const chargedQty = (p: ProductWithStock) => (p.paidOnHand == null ? n(p.onHand) : n(p.paidOnHand))

const pctPair = (l: number, b: number) => [l, b].filter((d) => d > 0).map((d) => `${+d.toFixed(2)}%`).join(' + ') || '0%'
const batchText = (p: ProductWithStock) => (p.batches ?? []).map((b) => `${b.invoiceNo}: ${b.qty}${b.freeQty ? `+${b.freeQty} free` : ''} × ${rs(b.unitPrice)} − ${pctPair(b.lineDiscPct, b.billDiscPct)}`).join('\n')
const discLabel = (p: ProductWithStock) => p.mixedDisc ? `mixed · ${(p.batches ?? []).filter((b) => b.qty > 0).length} refills` : [n(p.lineDiscPct), n(p.billDiscPct)].filter((d) => d > 0).map((d) => `${+d.toFixed(2)}%`).join(' + ') || '—'

type ListState = ReturnType<typeof useListState<{ tab: string; stock: string; size: string; status: string }>>

function StockTable({ s, set }: { s: ListState[0]; set: ListState[1] }) {
  const params = { search: s.search, page: s.page, pageSize: s.pageSize, sort: s.sort, dir: s.dir, stock: s.stock, size: s.size, status: s.status === 'all' ? '' : s.status }
  const q = usePaged<ProductWithStock, { units: number; paidUnits: number; freeUnits: number; grossValue: number; discountValue: number; costValue: number; sellValue: number; low: number; out: number }>('products', '/products', params)
  const { data: meta } = useProductMeta()
  const sum = q.data?.summary

  const exportExcel = async () => {
    const all = await fetchAll<ProductWithStock>('/products', { ...params, page: undefined, pageSize: undefined })
    await downloadExcel('stock', [{
      name: 'Stock',
      columns: [
        { header: 'Code' }, { header: 'Size' }, { header: 'Name' },
        { header: 'Total qty', type: 'int' }, { header: 'Charged qty', type: 'int' }, { header: 'Free qty', type: 'int' },
        { header: 'Unit price', type: 'money' }, { header: 'Disc' }, { header: 'Amount', type: 'money' },
      ],
      rows: all.map((p) => [p.code, p.size, p.name, n(p.onHand), chargedQty(p), freeQty(p), p.listPrice, discLabel(p), n(p.stockValue)]),
      totals: [3, 4, 5, 8],
    }, {
      name: 'Stock by GRN',
      columns: [
        { header: 'Code' }, { header: 'Item' }, { header: 'GRN / invoice' }, { header: 'Date', type: 'date' }, { header: 'Charged qty on hand', type: 'int' }, { header: 'Free qty on hand', type: 'int' },
        { header: 'Unit price', type: 'money' }, { header: 'Line disc %', type: 'pct' }, { header: 'Bill disc %', type: 'pct' }, { header: 'Amount', type: 'money' }, { header: 'Stock amount', type: 'money' },
      ],
      rows: all.flatMap((p) => (p.batches ?? []).map((b) => [p.code, `${p.size} ${p.name}`, b.invoiceNo, b.date || null, b.qty, b.freeQty, b.unitPrice, b.lineDiscPct, b.billDiscPct, b.amount, b.stockAmount])),
      totals: [4, 5, 9, 10],
    }])
  }

  const columns: Column<ProductWithStock>[] = [
    { key: 'item', header: 'Item', sortKey: 'name', render: (p) => <Link to={`/products/${p.id}`} className="font-medium hover:underline" title={p.code}><span className="text-stone-500">{p.size}</span> {p.name}</Link> },
    {
      key: 'qty', header: 'Total qty', sortKey: 'onHand', align: 'right',
      render: (p) => (
        <span className="inline-flex flex-col items-end">
          <StockBadge onHand={n(p.onHand)} reorderLevel={p.reorderLevel} />
          {freeQty(p) > 0 && <span className="mt-0.5 text-[11px] text-stone-500">{chargedQty(p)} + <span className="text-brand-700">{freeQty(p)} free</span></span>}
        </span>
      ),
    },
    { key: 'price', header: 'Unit price', sortKey: 'listPrice', align: 'right', render: (p) => (p.listPrice > 0 ? rs(p.listPrice) : <Badge tone="green">Free</Badge>) },
    { key: 'disc', header: 'Disc', align: 'right', render: (p) => <span className="whitespace-nowrap text-stone-600" title={batchText(p)}>{discLabel(p)}</span> },
    { key: 'value', header: 'Amount', sortKey: 'stockValue', align: 'right', render: (p) => <span className="font-semibold" title={`${chargedQty(p)} × ${rs(p.listPrice)} = ${rs(p.grossValue)} − discount ${rs(p.discountValue)}`}>{rs(n(p.stockValue))}</span> },
  ]


  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat label="Total qty" value={sum?.units ?? 0} hint={`${sum?.paidUnits ?? 0} + ${sum?.freeUnits ?? 0} free · ${q.data?.total ?? 0} items`} />
        <Stat label="Amount" value={`Rs ${rs(sum?.costValue)}`} tone="good" hint={`after discount · ${sum?.low ?? 0} low · ${sum?.out ?? 0} out of stock`} />
      </div>
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} />
        <select className="input" value={s.stock} onChange={(e) => set({ stock: e.target.value })}>
          <option value="">All stock levels</option>
          <option value="in">In stock</option>
          <option value="low">Low (at/below reorder)</option>
          <option value="out">Out of stock</option>
        </select>
        <select className="input" value={s.size} onChange={(e) => set({ size: e.target.value })}>
          <option value="">All sizes</option>
          {meta?.sizes.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select className="input" value={s.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="active">Active items</option>
          <option value="all">All items</option>
          <option value="inactive">Inactive</option>
        </select>
        <button className="btn-secondary" onClick={exportExcel}><FileSpreadsheet size={16} /> Excel</button>
      </Filters>
      <DataTable
        rows={q.data?.items ?? []}
        columns={columns}
        rowKey={(p) => p.id}
        loading={q.isFetching}
        error={q.error}
        page={q.data?.page ?? 1}
        pageSize={s.pageSize}
        total={q.data?.total ?? 0}
        onPage={(p) => set({ page: p }, false)}
        onPageSize={(n) => set({ pageSize: n })}
        sort={s.sort}
        dir={s.dir}
        onSort={(k, d) => set({ sort: k, dir: d })}
        rowLink={(p) => `/products/${p.id}`}
        empty="Nothing here."
        mobileCard={(p) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium"><span className="text-stone-500">{p.size}</span> {p.name}</p>
              <p className="text-xs text-stone-500">{p.listPrice > 0 ? `Rs ${rs(p.listPrice)}` : 'Free'} · disc {discLabel(p)}{freeQty(p) ? ` · ${chargedQty(p)} + ${freeQty(p)} free` : ''}</p>
              <p className="text-xs font-medium text-stone-700">Amount Rs {rs(n(p.stockValue))}</p>
            </div>
            <StockBadge onHand={p.onHand} reorderLevel={p.reorderLevel} />
          </div>
        )}
      />
    </>
  )
}

function Adjustments({ s, set }: { s: ListState[0]; set: ListState[1] }) {
  const q = usePaged<AdjRow>('adjustments', '/adjustments', { search: s.search, page: s.page, pageSize: s.pageSize, sort: s.sort, dir: s.dir })
  const confirm = useConfirm()
  const del = useApiMutation((id: number) => api.del(`/adjustments/${id}`), { success: 'Adjustment removed — stock restored' })
  const columns: Column<AdjRow>[] = [
    { key: 'date', header: 'Date', sortKey: 'date', render: (a) => <span className="text-stone-500">{a.date}</span> },
    { key: 'item', header: 'Item', sortKey: 'product', render: (a) => <Link className="hover:underline" to={`/products/${a.productId}`}>{a.productLabel}</Link> },
    { key: 'reason', header: 'Reason', render: (a) => <Badge>{a.reason}</Badge> },
    { key: 'notes', header: 'Note', hideBelow: 'lg', render: (a) => <span className="text-stone-500">{a.notes}</span> },
    { key: 'qty', header: 'Qty', sortKey: 'qty', align: 'right', render: (a) => <span className={`font-medium ${a.qty < 0 ? 'text-red-600' : 'text-brand-700'}`}>{a.qty > 0 ? '+' : ''}{a.qty}</span> },
    {
      key: 'del', header: '', align: 'right', mobile: false,
      render: (a) => (
        <button className="btn-ghost hover:text-red-600" aria-label="Delete" onClick={async () => (await confirm({ title: 'Remove this adjustment?', message: `${a.productLabel}: ${a.qty > 0 ? '+' : ''}${a.qty} (${a.reason}) will be reversed.`, tone: 'danger', confirmText: 'Remove' })) && del.mutate(a.id)}>
          <Trash2 size={15} />
        </button>
      ),
    },
  ]
  return (
    <>
      <Filters><SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Item, reason, note…" /></Filters>
      <DataTable
        rows={q.data?.items ?? []}
        columns={columns}
        rowKey={(a) => a.id}
        loading={q.isFetching}
        error={q.error}
        page={q.data?.page ?? 1}
        pageSize={s.pageSize}
        total={q.data?.total ?? 0}
        onPage={(p) => set({ page: p }, false)}
        onPageSize={(n) => set({ pageSize: n })}
        sort={s.sort}
        dir={s.dir}
        onSort={(k, d) => set({ sort: k, dir: d })}
        empty="No adjustments yet. Use Adjust stock for damage, expiry, returns or count corrections."
      />
    </>
  )
}

export function AdjustModal({ onClose, productId: pid0 }: { onClose: () => void; productId?: number }) {
  const { data: products = [] } = useProductOptions()
  const [productId, setProductId] = useState<number | null>(pid0 ?? null)
  const [mode, setMode] = useState<'count' | 'delta'>('count')
  const [value, setValue] = useState<number | null>(null)
  const [reason, setReason] = useState<AdjReason>('Count correction')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(todayLK())
  const confirm = useConfirm()
  const save = useApiMutation((body: unknown) => api.post('/adjustments', body), { success: 'Stock adjusted', onSuccess: onClose })
  const p = products.find((x) => x.id === productId)
  const current = p?.onHand ?? 0
  const delta = value == null ? 0 : mode === 'count' ? value - current : value

  const submit = async () => {
    if (!productId || !delta) return
    const ok = await confirm({
      title: 'Save stock adjustment?',
      message: <>{p?.size} {p?.name}: <b>{current}</b> → <b>{current + delta}</b> ({delta > 0 ? '+' : ''}{delta}) · {reason}</>,
      tone: delta < 0 ? 'warning' : 'primary',
      confirmText: 'Save',
    })
    if (ok) save.mutate({ date, productId, qty: Math.round(delta), reason, notes })
  }

  return (
    <Modal
      open
      title="Adjust stock"
      onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!productId || !delta || save.isPending} onClick={submit}>Save adjustment</button></>}
    >
      <div className="space-y-4">
        <Field label="Item">
          <Combobox items={products} value={productId} onChange={setProductId} getId={(x) => x.id} getLabel={(x) => `${x.size} ${x.name}`} getSearch={(x) => `${x.code} ${x.size} ${x.name}`} autoFocus={!pid0}
            renderItem={(x) => <div className="flex justify-between gap-2"><span className="truncate">{x.size} {x.name}</span><span className="text-xs text-stone-500">{x.onHand}</span></div>} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <button className={mode === 'count' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('count')}>Set counted qty</button>
          <button className={mode === 'delta' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('delta')}>Add / remove</button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={mode === 'count' ? 'Physical count' : 'Qty (+ add / − remove)'}><NumberInput step={1} value={value} onChange={setValue} autoFocus={!!pid0} /></Field>
          <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Reason">
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value as AdjReason)}>
              {ADJ_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Note"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 3 bottles leaking" /></Field>
        </div>
        {p && (
          <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
            System qty <b>{current}</b> → <b className={current + delta < 0 ? 'text-red-600' : ''}>{current + delta}</b> ({delta >= 0 ? '+' : ''}{delta})
          </p>
        )}
      </div>
    </Modal>
  )
}
