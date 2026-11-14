// Order requests (purchase orders) to the supplier: a printable list of items to order, with prices shown or hidden,
// catalogue items picked from the product list or items typed by hand that are not in the stock list yet.
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, FileSpreadsheet, Keyboard, PackagePlus, Pencil, Plus, Printer, Send, Trash2, Undo2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { qtyFmt, rs, todayLK, type OrderRequest, type OrderRequestStatus, type Settings, type Supplier } from '@pjd/shared'
import Combobox from '../components/Combobox'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column } from '../components/DataTable'
import PrintPreview from '../components/PrintPreview'
import { Badge, ErrorBox, Field, Filters, NumberInput, PageHeader, SearchBox, Spinner, Stat, type Tone } from '../components/ui'
import { api, fetchAll } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { quickPrint } from '../lib/print'
import { useApiMutation, useListState, usePaged, useProductOptions, useSettings, useSupplierOptions, type ProductOption, type SupplierOption } from '../lib/hooks'

interface RequestRow {
  id: number
  requestNo: string
  date: string
  status: OrderRequestStatus
  showPrices: boolean
  notes: string
  supplierId: number
  supplierName: string
  lineCount: number
  units: number
  total: number | null
  unpriced: number
}

const STATUS: Record<OrderRequestStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  sent: { label: 'Sent', tone: 'blue' },
  received: { label: 'Received', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
}
export const StatusPill = ({ status }: { status: OrderRequestStatus }) => <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
const productLabel = (p: ProductOption) => `${p.size} ${p.name}`

// ---------------------------------------------------------------- list
export function OrderRequestList() {
  const [s, set] = useListState({ from: '', to: '', status: '', supplierId: '', sort: 'date', dir: 'desc' as const })
  const { data: suppliers = [] } = useSupplierOptions()
  const q = usePaged<RequestRow, { count: number; open: number; units: number; total: number }>('order-requests', '/order-requests', s)
  const sum = q.data?.summary
  const columns: Column<RequestRow>[] = [
    { key: 'no', header: 'Request', sortKey: 'requestNo', render: (r) => <Link to={`/purchases/requests/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.requestNo}</Link> },
    { key: 'date', header: 'Date', sortKey: 'date', render: (r) => <span className="text-stone-500">{r.date}</span> },
    { key: 'supplier', header: 'Supplier', sortKey: 'supplier', render: (r) => r.supplierName },
    { key: 'items', header: 'Items', align: 'right', render: (r) => r.lineCount },
    { key: 'units', header: 'Units', sortKey: 'units', align: 'right', render: (r) => qtyFmt(r.units) },
    { key: 'total', header: 'Amount', sortKey: 'total', align: 'right', render: (r) => (r.total === null ? <span className="text-stone-300">—</span> : <span>{rs(r.total)}{r.unpriced ? <span className="block text-xs text-stone-400">{r.unpriced} without price</span> : null}</span>) },
    { key: 'prices', header: 'Prices', hideBelow: 'lg', mobile: false, render: (r) => <span className="text-xs text-stone-500">{r.showPrices ? 'Shown' : 'Hidden'}</span> },
    { key: 'status', header: 'Status', sortKey: 'status', render: (r) => <StatusPill status={r.status} /> },
  ]
  const exportExcel = async () => {
    const all = await fetchAll<RequestRow>('/order-requests', { ...s, page: undefined, pageSize: undefined })
    await downloadExcel('order-requests', [{
      name: 'Order requests',
      columns: [{ header: 'Request no' }, { header: 'Date', type: 'date' }, { header: 'Supplier' }, { header: 'Status' }, { header: 'Items', type: 'int' }, { header: 'Units', type: 'int' }, { header: 'Amount', type: 'money' }, { header: 'Lines without price', type: 'int' }, { header: 'Prices shown' }, { header: 'Notes' }],
      rows: all.map((r) => [r.requestNo, r.date, r.supplierName, STATUS[r.status].label, r.lineCount, r.units, r.total, r.unpriced, r.showPrices, r.notes]),
      totals: [4, 5, 6],
    }])
  }
  return (
    <div>
      <PageHeader
        title="Order requests"
        subtitle="Lists of items to order from the supplier — print or send one, then enter the GRN when the goods arrive"
        back={{ to: '/purchases', label: 'Purchases' }}
        actions={
          <>
            <button className="btn-secondary" onClick={exportExcel}><FileSpreadsheet size={16} /> Excel</button>
            <Link to="/purchases/requests/new" className="btn-primary"><Plus size={16} /> New request</Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Requests" value={sum ? sum.count : '…'} />
        <Stat label="Open" value={sum ? sum.open : '…'} hint="draft or sent, goods not in yet" tone={sum?.open ? 'warn' : 'default'} />
        <Stat label="Units" value={sum ? qtyFmt(sum.units) : '…'} />
        <Stat label="Amount" value={sum ? `Rs ${rs(sum.total)}` : '…'} hint="priced lines only, at the supplier's list price" />
      </div>
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Request no, supplier, notes…" />
        <select className="input" value={s.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          <option value="open">Open (draft or sent)</option>
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="input" value={s.supplierId} onChange={(e) => set({ supplierId: e.target.value })} aria-label="Supplier">
          <option value="">All suppliers</option>
          {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:w-auto">
          <input type="date" className="input" value={s.from} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
          <span className="text-stone-400">to</span>
          <input type="date" className="input" value={s.to} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
        </div>
      </Filters>
      <DataTable
        rows={q.data?.items ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        page={q.data?.page ?? s.page}
        pageSize={s.pageSize}
        total={q.data?.total ?? 0}
        onPage={(p) => set({ page: p }, false)}
        onPageSize={(n) => set({ pageSize: n })}
        sort={s.sort}
        dir={s.dir}
        onSort={(k, d) => set({ sort: k, dir: d })}
        rowLink={(r) => `/purchases/requests/${r.id}`}
        empty="No order requests yet — make one with New request."
      />
    </div>
  )
}

// ---------------------------------------------------------------- printable document
interface DocLine { code: string; name: string; size: string; qty: number; unitPrice: number | null; notes: string }
interface DocData { requestNo: string; date: string; status: OrderRequestStatus; showPrices: boolean; notes: string; supplierName: string; lines: DocLine[] }

export function OrderRequestDoc({ doc, supplier, settings }: { doc: DocData; supplier?: Supplier; settings?: Settings }) {
  const priced = doc.lines.filter((l) => l.unitPrice !== null)
  const units = doc.lines.reduce((s, l) => s + l.qty, 0)
  const total = priced.reduce((s, l) => s + l.qty * (l.unitPrice ?? 0), 0)
  const unpriced = doc.lines.length - priced.length
  const showPrices = doc.showPrices
  return (
    <div className="print-area card mx-auto max-w-4xl bg-white p-4 text-[12px] text-stone-900 sm:p-6 sm:text-[13px] md:p-10">
      <div className="text-center">
        <h2 className="text-lg font-bold tracking-tight sm:text-xl">{settings?.name ?? 'Pasyala Janith Distributor'}</h2>
        {settings?.address && <p className="text-stone-600">{settings.address}</p>}
        {settings && <p className="text-stone-600">{[settings.phone && `Tel: ${settings.phone}`, settings.email && `Email: ${settings.email}`].filter(Boolean).join(' · ')}</p>}
        <p className="mt-3 text-base font-bold tracking-[0.2em] sm:mt-4 sm:text-lg">ORDER REQUEST</p>
      </div>
      <div className="mt-4 grid gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-6">
        <dl className="grid grid-cols-[90px_1fr] gap-y-1 sm:grid-cols-[110px_1fr]">
          <dt className="font-semibold">To</dt>
          <dd className="uppercase">{supplier?.name ?? doc.supplierName}</dd>
          {supplier?.address && (<><dt className="font-semibold">Address</dt><dd>{supplier.address}</dd></>)}
          {supplier?.phone && (<><dt className="font-semibold">Phone</dt><dd>{supplier.phone}</dd></>)}
          {settings?.supplierCustomerCode && (<><dt className="font-semibold">Our code</dt><dd>{settings.supplierCustomerCode}</dd></>)}
        </dl>
        <dl className="grid grid-cols-[90px_1fr] gap-y-1 sm:grid-cols-[110px_1fr] sm:justify-self-end">
          <dt className="font-semibold">Request No</dt><dd>{doc.requestNo}</dd>
          <dt className="font-semibold">Date</dt><dd>{doc.date}</dd>
          {doc.status !== 'draft' && (<><dt className="font-semibold">Status</dt><dd>{STATUS[doc.status].label}</dd></>)}
        </dl>
      </div>
      <div className="-mx-1 mt-4 overflow-x-auto sm:mx-0 sm:mt-5">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y-2 border-stone-800 text-left text-[11px] uppercase">
              <th className="py-1.5 pr-2 text-right">#</th>
              <th className="py-1.5 pr-2">Code</th>
              <th className="py-1.5 pr-2">Item</th>
              <th className="py-1.5 pr-2">Size / variation</th>
              <th className="py-1.5 pr-2 text-right">Qty</th>
              {showPrices && <th className="py-1.5 pr-2 text-right">Unit price (Rs)</th>}
              {showPrices && <th className="py-1.5 text-right">Amount (Rs)</th>}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i} className="border-b border-stone-100">
                <td className="py-1 pr-2 text-right tabular-nums text-stone-500">{i + 1}</td>
                <td className="py-1 pr-2 font-mono text-[11px]">{l.code || <span className="text-stone-400">new</span>}</td>
                <td className="py-1 pr-2 uppercase">{l.name}{l.notes && <span className="block text-[11px] normal-case text-stone-500">{l.notes}</span>}</td>
                <td className="py-1 pr-2">{l.size}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{qtyFmt(l.qty)}</td>
                {showPrices && <td className="py-1 pr-2 text-right tabular-nums">{l.unitPrice === null ? '—' : rs(l.unitPrice)}</td>}
                {showPrices && <td className="py-1 text-right tabular-nums">{l.unitPrice === null ? '—' : rs(l.qty * l.unitPrice)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-stone-800 font-semibold">
              <td className="py-1.5 pr-2" colSpan={4}>Total · {doc.lines.length} item{doc.lines.length === 1 ? '' : 's'}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{qtyFmt(units)}</td>
              {showPrices && <td className="py-1.5 pr-2" />}
              {showPrices && <td className="py-1.5 text-right tabular-nums">{priced.length ? rs(total) : '—'}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
      {showPrices && unpriced > 0 && <p className="mt-2 text-[11px] text-stone-500">{unpriced} item{unpriced === 1 ? ' has' : 's have'} no price — please quote.</p>}
      {doc.notes && <p className="mt-4 whitespace-pre-wrap"><span className="font-semibold">Notes: </span>{doc.notes}</p>}
      <div className="mt-10 grid grid-cols-2 gap-6 text-center text-[11px] sm:grid-cols-3">
        {['Prepared by', 'Approved by', 'Received by (supplier)'].map((s) => (
          <div key={s} className="border-t border-stone-800 pt-1">{s}</div>
        ))}
      </div>
    </div>
  )
}

const useSupplier = (id: number | null | undefined) =>
  useQuery({ queryKey: ['suppliers', id, 'detail'], queryFn: () => api.get<{ supplier: Supplier }>(`/suppliers/${id}`).then((r) => r.supplier), enabled: !!id, staleTime: 60_000 })

// ---------------------------------------------------------------- editor
interface EditLine { key: string; manual: boolean; productId: number | null; name: string; size: string; qty: number; unitPrice: number | null; notes: string }
interface Draft { supplierId: number | null; date: string; status: OrderRequestStatus; showPrices: boolean; notes: string; lines: EditLine[] }
interface Suggestion { productId: number; code: string; name: string; size: string; onHand: number; reorderLevel: number; qty: number; unitPrice: number | null }
let seq = 0
const newLine = (manual = false): EditLine => ({ key: `l${++seq}`, manual, productId: null, name: '', size: '', qty: 1, unitPrice: null, notes: '' })
const fromRequest = (r: OrderRequest): Draft => ({
  supplierId: r.supplierId, date: r.date, status: r.status, showPrices: r.showPrices, notes: r.notes,
  lines: r.lines.map((l) => ({ key: `l${++seq}`, manual: l.productId === null, productId: l.productId, name: l.name, size: l.size, qty: l.qty, unitPrice: l.unitPrice, notes: l.notes })),
})
const emptyRequest = (suppliers: SupplierOption[]): Draft => ({ supplierId: suppliers.length === 1 ? suppliers[0].id : null, date: todayLK(), status: 'draft', showPrices: true, notes: '', lines: [newLine()] })

export function OrderRequestEdit() {
  const { id } = useParams()
  const existing = useQuery({ queryKey: ['order-requests', id], queryFn: () => api.get<OrderRequest>(`/order-requests/${id}`), enabled: !!id })
  const { data: suppliers = [] } = useSupplierOptions()
  const { data: products = [] } = useProductOptions()
  if (id && existing.isLoading) return <Spinner />
  if (id && existing.error) return <div><PageHeader title="Edit order request" back={{ to: '/purchases/requests', label: 'Order requests' }} /><ErrorBox error={existing.error} /></div>
  const req = existing.data
  return <RequestForm key={`${req?.id ?? 'new'}-${suppliers.length}`} id={req?.id} requestNo={req?.requestNo} initial={req ? fromRequest(req) : emptyRequest(suppliers)} suppliers={suppliers} products={products} />
}

function RequestForm({ id, requestNo, initial, suppliers, products }: { id?: number; requestNo?: string; initial: Draft; suppliers: SupplierOption[]; products: ProductOption[] }) {
  const nav = useNavigate()
  const { data: settings } = useSettings()
  const [d, setD] = useState<Draft>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState(false)
  const [dirty, setDirty] = useState(false)
  const supplier = useSupplier(d.supplierId)
  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const patch = (p: Partial<Draft>) => { setD((x) => ({ ...x, ...p })); setDirty(true) }
  const setLine = (key: string, p: Partial<EditLine>) => { setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...p } : l)) })); setDirty(true) }
  const removeLine = (key: string) => setD((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((l) => l.key !== key) : [newLine()] }))
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const addSuggestions = async () => {
    try {
      const sug = await api.get<Suggestion[]>('/order-requests/suggestions')
      const have = new Set(d.lines.map((l) => l.productId))
      const add = sug.filter((x) => !have.has(x.productId))
      if (!add.length) { toast.info(sug.length ? 'Every low-stock item is already on the list' : 'Nothing is at or below its reorder level'); return }
      patch({ lines: [...d.lines.filter((l) => l.productId || l.name.trim()), ...add.map((x) => ({ ...newLine(false), productId: x.productId, qty: x.qty, unitPrice: x.unitPrice }))] })
      toast.success(`${add.length} low-stock item${add.length === 1 ? '' : 's'} added — check the quantities`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const docLines: DocLine[] = d.lines
    .filter((l) => (l.manual ? l.name.trim() : l.productId))
    .map((l) => { const p = l.manual ? undefined : pmap.get(l.productId!); return { code: p?.code ?? '', name: p?.name ?? l.name.trim(), size: p?.size ?? l.size, qty: l.qty, unitPrice: l.unitPrice, notes: l.notes } })
  const units = docLines.reduce((s, l) => s + l.qty, 0)
  const priced = docLines.filter((l) => l.unitPrice !== null)
  const total = priced.reduce((s, l) => s + l.qty * (l.unitPrice ?? 0), 0)

  const validate = () => {
    const e: Record<string, string> = {}
    if (!d.supplierId) e.supplier = 'Choose a supplier'
    if (!d.date) e.date = 'Enter the date'
    if (!d.lines.length) e.lines = 'Add at least one item'
    for (const l of d.lines) {
      if (l.manual ? !l.name.trim() : !l.productId) e[`line:${l.key}`] = l.manual ? 'Type the item name' : 'Choose an item'
      else if (!(l.qty >= 1)) e[`line:${l.key}`] = 'Qty must be at least 1'
    }
    setErrors(e)
    if (Object.keys(e).length) requestAnimationFrame(() => document.querySelector('[data-error="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
    return !Object.keys(e).length
  }
  const save = useApiMutation(
    (body: unknown) => (id ? api.put<{ id: number; requestNo: string }>(`/order-requests/${id}`, body) : api.post<{ id: number; requestNo: string }>('/order-requests', body)),
    { success: (r) => `Order request ${r.requestNo} saved`, onSuccess: (r) => { setDirty(false); nav(`/purchases/requests/${r.id}`, { replace: true }) } },
  )
  const submit = () => {
    if (!validate()) return
    save.mutate({
      supplierId: d.supplierId, date: d.date, status: d.status, showPrices: d.showPrices, notes: d.notes,
      lines: d.lines.map((l) => ({ productId: l.manual ? null : l.productId, name: l.manual ? l.name.trim() : '', size: l.manual ? l.size.trim() : '', qty: l.qty, unitPrice: l.unitPrice, notes: l.notes.trim() })),
    })
  }
  const doc: DocData = { requestNo: requestNo ?? 'Draft', date: d.date, status: d.status, showPrices: d.showPrices, notes: d.notes, supplierName: suppliers.find((x) => x.id === d.supplierId)?.name ?? '', lines: docLines }
  const priceCols = d.showPrices

  return (
    <div>
      <PageHeader
        title={requestNo ? `Edit ${requestNo}` : 'New order request'}
        subtitle="Pick items from the product list, or type an item by hand when it is not in the stock list yet. Prices can be hidden on the printed request."
        back={{ to: id ? `/purchases/requests/${id}` : '/purchases/requests', label: requestNo ?? 'Order requests' }}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="card space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Supplier" error={errors.supplier} className="sm:col-span-2">
                <div data-error={!!errors.supplier}>
                  <select className="input" value={d.supplierId ?? ''} onChange={(e) => patch({ supplierId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Choose…</option>
                    {suppliers.filter((x) => x.active || x.id === d.supplierId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Date" error={errors.date}><div data-error={!!errors.date}><input type="date" className="input" value={d.date} onChange={(e) => patch({ date: e.target.value })} /></div></Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={d.showPrices} onChange={(e) => patch({ showPrices: e.target.checked })} />
              <span><span className="font-medium">Show prices on the request</span><span className="block text-xs text-stone-500">Untick to send the supplier only the items and quantities. Prices start from the supplier's list price and can be changed per line.</span></span>
            </label>
          </div>

          <div className="card p-4">
            <div className={`mb-2 hidden gap-2 px-1 text-xs font-medium uppercase tracking-wide text-stone-500 md:grid ${priceCols ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_88px_120px_110px_36px]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_88px_36px]'}`}>
              <span>Item</span><span>Size / variation</span><span className="text-right">Qty</span>{priceCols && <span className="text-right">Unit price</span>}{priceCols && <span className="text-right">Amount</span>}<span />
            </div>
            {errors.lines && <p className="mb-2 text-sm text-red-600" data-error="true">{errors.lines}</p>}
            <ul className="space-y-2">
              {d.lines.map((l, i) => {
                const p = l.manual ? undefined : pmap.get(l.productId!)
                const err = errors[`line:${l.key}`]
                return (
                  <li key={l.key} data-line={l.key} data-error={!!err} className={`rounded-lg border p-2 md:border-0 md:p-0 ${err ? 'border-red-300' : 'border-stone-200'}`}>
                    <div className={`grid grid-cols-1 gap-2 md:items-start ${priceCols ? 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_88px_120px_110px_36px]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_88px_36px]'}`}>
                      {/* phones: item + remove on one row, size on the next, qty / price / amount on the last; desktop: one row, ordered left to right */}
                      <div className="flex items-start gap-2 md:contents">
                        <div className="min-w-0 flex-1 md:order-1">
                          {l.manual ? (
                            <input className="input" value={l.name} placeholder="Item name (not in the stock list)" onChange={(e) => setLine(l.key, { name: e.target.value })} autoFocus={i === d.lines.length - 1 && !l.name} aria-label="Item name" />
                          ) : (
                            <Combobox
                              items={products.filter((x) => x.active || x.id === l.productId)}
                              value={l.productId}
                              onChange={(pid, x) => {
                                setLine(l.key, { productId: pid, unitPrice: x.listPrice > 0 ? x.listPrice : null })
                                requestAnimationFrame(() => (document.querySelector(`[data-line="${l.key}"] input[aria-label="Qty"]`) as HTMLInputElement | null)?.select())
                              }}
                              getId={(x) => x.id}
                              getLabel={productLabel}
                              getSearch={(x) => `${x.code} ${x.size} ${x.name}`}
                              placeholder="Search code or name…"
                              autoFocus={i > 0 && i === d.lines.length - 1 && !l.productId}
                              renderItem={(x) => (
                                <div className="flex items-center justify-between gap-3">
                                  <span className="min-w-0 truncate"><span className="font-medium">{productLabel(x)}</span> <span className="text-xs text-stone-400">{x.code}</span></span>
                                  <span className={`shrink-0 text-xs ${x.onHand <= 0 ? 'text-red-600' : 'text-stone-500'}`}>{x.onHand} on hand</span>
                                </div>
                              )}
                            />
                          )}
                          <span className="mt-1 block text-xs text-stone-500">{l.manual ? <span className="inline-flex items-center gap-1"><Keyboard size={12} /> typed by hand</span> : p ? `${p.code} · ${p.onHand} on hand` : ''}</span>
                        </div>
                        <button type="button" className="btn-ghost shrink-0 md:order-6 md:justify-self-end" onClick={() => removeLine(l.key)} aria-label="Remove line"><X size={16} /></button>
                      </div>
                      <div className="md:order-2">
                        {l.manual ? (
                          <input className="input" value={l.size} placeholder="Size / variation, e.g. 750ML, large" onChange={(e) => setLine(l.key, { size: e.target.value })} aria-label="Size or variation" />
                        ) : (
                          <input className="input" value={p?.size ?? ''} readOnly tabIndex={-1} aria-label="Size" placeholder="—" />
                        )}
                      </div>
                      <div className={`grid items-center gap-2 md:contents ${priceCols ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'}`}>
                        <NumberInput className="input text-right md:order-3" min={1} step={1} value={l.qty} onChange={(v) => setLine(l.key, { qty: Math.max(0, Math.round(v ?? 0)) })} aria-label="Qty" />
                        {priceCols && <NumberInput className="input text-right md:order-4" min={0} step="0.01" value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: v === null ? null : Math.max(0, v) })} aria-label="Unit price" placeholder="no price" />}
                        {priceCols && <div className="min-w-16 text-right text-sm tabular-nums md:order-5 md:pt-2">{l.unitPrice === null ? <span className="text-stone-300">—</span> : rs(l.qty * l.unitPrice)}</div>}
                      </div>
                    </div>
                    {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
                  </li>
                )
              })}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" onClick={() => patch({ lines: [...d.lines, newLine(false)] })}><Plus size={16} /> Add item</button>
              <button type="button" className="btn-secondary" onClick={() => patch({ lines: [...d.lines, newLine(true)] })} title="For an item that is not in the product list yet: type its name, size or variation and quantity"><Keyboard size={16} /> Add item by hand</button>
              <button type="button" className="btn-secondary" onClick={addSuggestions} title="Adds every active item at or below its reorder level, with a quantity that brings it to twice the level"><PackagePlus size={16} /> Add low-stock items</button>
            </div>
          </div>

          <div className="card p-4">
            <Field label="Notes to the supplier" hint="Printed under the items, e.g. delivery day or who to call">
              <textarea className="input min-h-20" value={d.notes} onChange={(e) => patch({ notes: e.target.value })} />
            </Field>
          </div>
        </div>

        <aside className="card h-fit p-4 lg:sticky lg:top-4">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
            <dt className="text-stone-500">Items</dt><dd className="text-right tabular-nums">{docLines.length}</dd>
            <dt className="text-stone-500">Units</dt><dd className="text-right tabular-nums">{qtyFmt(units)}</dd>
            {priceCols && <><dt className="text-stone-500">Amount</dt><dd className="text-right font-semibold tabular-nums">{priced.length ? `Rs ${rs(total)}` : '—'}</dd></>}
            {priceCols && docLines.length - priced.length > 0 && <><dt className="text-stone-500">Without price</dt><dd className="text-right tabular-nums">{docLines.length - priced.length}</dd></>}
            {!priceCols && <><dt className="text-stone-500">Prices</dt><dd className="text-right">hidden</dd></>}
          </dl>
          {id && (
            <Field label="Status" className="mt-3">
              <select className="input" value={d.status} onChange={(e) => patch({ status: e.target.value as OrderRequestStatus })}>
                {(Object.keys(STATUS) as OrderRequestStatus[]).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
              </select>
            </Field>
          )}
          <div className="mt-4 grid gap-2">
            <button className="btn-primary" disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : id ? 'Save changes' : 'Save request'}</button>
            <button className="btn-secondary" onClick={() => setPreview(true)} disabled={!docLines.length}><Printer size={16} /> Preview</button>
            <button className="btn-ghost" onClick={() => nav(-1)}>Cancel</button>
          </div>
        </aside>
      </div>
      <PrintPreview open={preview} onClose={() => setPreview(false)} title={requestNo ?? 'order-request'}>
        <OrderRequestDoc doc={doc} supplier={supplier.data} settings={settings} />
      </PrintPreview>
    </div>
  )
}

// ---------------------------------------------------------------- view
export function OrderRequestView() {
  const { id } = useParams()
  const nav = useNavigate()
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['order-requests', id], queryFn: () => api.get<OrderRequest>(`/order-requests/${id}`) })
  const { data: settings } = useSettings()
  const supplier = useSupplier(q.data?.supplierId)
  const [preview, setPreview] = useState(false)
  const flags = useApiMutation((f: { status?: OrderRequestStatus; showPrices?: boolean }) => api.put<OrderRequest>(`/order-requests/${id}/flags`, f), {
    success: (r, f) => (f.status ? `${r.requestNo} is now ${STATUS[r.status].label.toLowerCase()}` : r.showPrices ? 'Prices shown on the request' : 'Prices hidden on the request'),
  })
  const del = useApiMutation(() => api.del(`/order-requests/${id}`), { success: 'Order request deleted', onSuccess: () => nav('/purchases/requests', { replace: true }) })
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <div><PageHeader title="Order request" back={{ to: '/purchases/requests', label: 'Order requests' }} /><ErrorBox error={q.error} onRetry={() => q.refetch()} /></div>
  const r = q.data
  const open = r.status === 'draft' || r.status === 'sent'
  const askDelete = async () => {
    if (await confirm({ title: `Delete ${r.requestNo}?`, message: 'The request is removed. Stock and purchases are not affected.', tone: 'danger', confirmText: 'Delete' })) del.mutate(undefined)
  }
  const cancel = async () => {
    if (await confirm({ title: `Cancel ${r.requestNo}?`, message: 'The request is kept as cancelled; you can reopen it later.', confirmText: 'Cancel request' })) flags.mutate({ status: 'cancelled' })
  }
  const doc: DocData = { ...r, lines: r.lines }
  const sheet = <OrderRequestDoc doc={doc} supplier={supplier.data} settings={settings} />
  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{r.requestNo} <StatusPill status={r.status} /></span>}
        subtitle={`${r.supplierName} · ${r.date}`}
        back={{ to: '/purchases/requests', label: 'Order requests' }}
        actions={
          <>
            {open && <button className="btn-secondary" onClick={askDelete}><Trash2 size={15} /> Delete</button>}
            {r.status !== 'received' && <Link to={`/purchases/requests/${r.id}/edit`} className="btn-secondary"><Pencil size={15} /> Edit</Link>}
            {r.status === 'draft' && <button className="btn-secondary" onClick={() => flags.mutate({ status: 'sent' })}><Send size={15} /> Mark as sent</button>}
            {r.status === 'sent' && <Link to={`/purchases/new?request=${r.id}`} className="btn-secondary" title="Opens a new GRN with these items filled in"><ClipboardList size={15} /> Enter GRN</Link>}
            {r.status === 'sent' && <button className="btn-secondary" onClick={() => flags.mutate({ status: 'received' })}>Mark as received</button>}
            {open && <button className="btn-ghost" onClick={cancel}>Cancel request</button>}
            {!open && <button className="btn-secondary" onClick={() => flags.mutate({ status: 'draft' })}><Undo2 size={15} /> Reopen as draft</button>}
            <button className="btn-secondary hidden sm:inline-flex" onClick={() => quickPrint(r.requestNo)}><Printer size={15} /> Quick print</button>
            <button className="btn-primary" onClick={() => setPreview(true)}><Printer size={15} /> Print preview</button>
          </>
        }
      />
      <div className="no-print mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Items" value={r.lines.length} />
        <Stat label="Units" value={qtyFmt(r.units)} />
        <Stat label="Amount" value={r.total === null ? '—' : `Rs ${rs(r.total)}`} hint={r.unpriced ? `${r.unpriced} item${r.unpriced === 1 ? '' : 's'} without a price` : "at the supplier's list price"} />
        <div className="card flex items-center p-3">
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={r.showPrices} disabled={flags.isPending} onChange={(e) => flags.mutate({ showPrices: e.target.checked })} />
            <span><span className="font-medium">Show prices</span><span className="block text-xs text-stone-500">on the printed request</span></span>
          </label>
        </div>
      </div>
      {sheet}
      <PrintPreview open={preview} onClose={() => setPreview(false)} title={r.requestNo}>{sheet}</PrintPreview>
    </div>
  )
}
