// Sales returns (credit notes): goods a customer sends back. The return is priced as sold, comes off the
// customer's balance (or is refunded in cash) and puts the goods back on the shelf unless they are written off.
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Eye, FileSpreadsheet, Loader2, Pencil, Plus, Printer, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { invoiceTotals, lineNet, qtyFmt, quotePrice, RETURN_REASONS, rs, todayLK, type Paged, type ReturnReason, type SalesInvoice, type SalesReturn } from '@pjd/shared'
import Combobox from '../components/Combobox'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column } from '../components/DataTable'
import InvoiceDocument from '../components/InvoiceDocument'
import PrintPreview from '../components/PrintPreview'
import { Badge, ErrorBox, Field, Filters, NumberInput, PageHeader, SearchBox, Spinner, Stat } from '../components/ui'
import { api, fetchAll } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { quickPrint } from '../lib/print'
import { useApiMutation, useCustomerOptions, useListState, usePaged, usePricingContext, useProductOptions, useSettings, type CustomerOption, type ProductOption } from '../lib/hooks'

interface ReturnRow {
  id: number
  returnNo: string
  date: string
  customerId: number
  partyName: string
  typeName: string
  salesInvoiceId: number | null
  invoiceNo: string | null
  reason: string
  restock: boolean
  netTotal: number
  costTotal: number
  refunded: number
  refundMethod: string
  lineCount: number
  units: number
  credited: number
}

type RefundMethod = 'Cash' | 'Cheque' | 'Bank Transfer'
const REFUND_METHODS: RefundMethod[] = ['Cash', 'Cheque', 'Bank Transfer']

// ================================================================ list

export function ReturnList() {
  const [s, set] = useListState({ from: '', to: '', customerId: '', restock: '', sort: 'date', dir: 'desc' as const })
  const { data: customers = [] } = useCustomerOptions()
  const q = usePaged<ReturnRow, { count: number; netTotal: number; refunded: number; credited: number; units: number }>('sales-returns', '/sales-returns', s)

  const columns: Column<ReturnRow>[] = [
    { key: 'no', header: 'Return', sortKey: 'returnNo', render: (r) => <Link to={`/sales/returns/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.returnNo}</Link> },
    { key: 'date', header: 'Date', sortKey: 'date', render: (r) => <span className="text-stone-500">{r.date}</span> },
    { key: 'party', header: 'Customer', sortKey: 'party', render: (r) => <span>{r.partyName}<span className="ml-1.5 text-xs text-stone-400">{r.typeName}</span></span> },
    { key: 'inv', header: 'Against invoice', hideBelow: 'lg', render: (r) => (r.salesInvoiceId ? <Link to={`/sales/${r.salesInvoiceId}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{r.invoiceNo}</Link> : <span className="text-stone-300">—</span>) },
    { key: 'reason', header: 'Reason', hideBelow: 'xl', render: (r) => <span className="text-stone-500">{r.reason}</span> },
    { key: 'units', header: 'Units', align: 'right', hideBelow: 'lg', mobile: false, render: (r) => <span className="text-stone-500">{qtyFmt(r.units)}</span> },
    { key: 'stock', header: 'Stock', render: (r) => <Badge tone={r.restock ? 'green' : 'amber'}>{r.restock ? 'Back in stock' : 'Written off'}</Badge> },
    { key: 'net', header: 'Return total', sortKey: 'netTotal', align: 'right', render: (r) => <span className="font-medium">{rs(r.netTotal)}</span> },
    { key: 'refund', header: 'Refunded', align: 'right', hideBelow: 'lg', render: (r) => (r.refunded ? rs(r.refunded) : <span className="text-stone-300">—</span>) },
    { key: 'credited', header: 'Credited', sortKey: 'credited', align: 'right', render: (r) => (r.credited ? <span className="text-brand-700">{rs(r.credited)}</span> : <span className="text-stone-300">—</span>) },
  ]

  const exportExcel = async () => {
    const all = await fetchAll<ReturnRow>('/sales-returns', { ...s, page: undefined, pageSize: undefined })
    await downloadExcel('sales-returns', [{
      name: 'Sales returns',
      columns: [
        { header: 'Return' }, { header: 'Date', type: 'date' }, { header: 'Customer' }, { header: 'Customer type' }, { header: 'Against invoice' }, { header: 'Reason' },
        { header: 'Stock' }, { header: 'Units', type: 'int' }, { header: 'Return total', type: 'money' }, { header: 'Refunded', type: 'money' }, { header: 'Refund method' }, { header: 'Credited to account', type: 'money' }, { header: 'Cost', type: 'money' },
      ],
      rows: all.map((r) => [r.returnNo, r.date, r.partyName, r.typeName, r.invoiceNo ?? '', r.reason, r.restock ? 'Back in stock' : 'Written off', r.units, r.netTotal, r.refunded, r.refundMethod, r.credited, r.costTotal]),
      totals: [7, 8, 9, 11, 12],
    }])
  }

  const sum = q.data?.summary
  return (
    <div>
      <PageHeader
        title="Sales returns"
        subtitle="Goods shops and customers sent back — credited to their account or refunded"
        back={{ to: '/sales', label: 'Sales' }}
        actions={
          <>
            <button className="btn-secondary" onClick={exportExcel}><FileSpreadsheet size={16} /> Excel</button>
            <Link to="/sales/returns/new" className="btn-primary"><Plus size={16} /> New return</Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Returns" value={qtyFmt(sum?.count)} hint={`${qtyFmt(sum?.units)} units`} />
        <Stat label="Returned value" value={`Rs ${rs(sum?.netTotal)}`} />
        <Stat label="Refunded in cash" value={`Rs ${rs(sum?.refunded)}`} tone={sum?.refunded ? 'warn' : 'default'} />
        <Stat label="Credited to accounts" value={`Rs ${rs(sum?.credited)}`} tone="good" />
      </div>
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Return no, customer, invoice…" />
        <select className="input" value={s.restock} onChange={(e) => set({ restock: e.target.value })} aria-label="Stock">
          <option value="">Stock: all</option>
          <option value="yes">Back in stock</option>
          <option value="no">Written off</option>
        </select>
        <select className="input" value={s.customerId} onChange={(e) => set({ customerId: e.target.value })}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
        rowLink={(r) => `/sales/returns/${r.id}`}
        empty={<>No returns yet. <Link to="/sales/returns/new" className="font-medium text-brand-700 hover:underline">Record a return</Link></>}
        mobileCard={(r) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-brand-700">{r.returnNo}</span>
              <span className="font-semibold tabular-nums">Rs {rs(r.netTotal)}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{r.partyName}</span>
              <Badge tone={r.restock ? 'green' : 'amber'}>{r.restock ? 'Back in stock' : 'Written off'}</Badge>
            </div>
            <div className="mt-0.5 flex justify-between text-xs text-stone-500">
              <span>{r.date}{r.invoiceNo ? ` · against ${r.invoiceNo}` : ''}</span>
              {r.refunded > 0 && <span>refunded Rs {rs(r.refunded)}</span>}
            </div>
          </div>
        )}
      />
    </div>
  )
}

// ================================================================ editor

interface RLine {
  key: string
  productId: number | null
  qty: number
  freeQty: number
  unitPrice: number
  discPct: number
  /** units (qty + free) sold on the invoice this return is against */
  sold?: number
}
interface RDraft {
  customerId: number | null
  date: string
  salesInvoiceId: number | null
  reason: ReturnReason
  restock: boolean
  billDiscPct: number
  refunded: number
  refundMethod: RefundMethod
  notes: string
  lines: RLine[]
}
let seq = 0
const newKey = () => `r${++seq}-${Date.now()}`
const blank = (): RLine => ({ key: newKey(), productId: null, qty: 1, freeQty: 0, unitPrice: 0, discPct: 0 })
const emptyDraft = (): RDraft => ({ customerId: null, date: todayLK(), salesInvoiceId: null, reason: 'Unsold stock', restock: true, billDiscPct: 0, refunded: 0, refundMethod: 'Cash', notes: '', lines: [blank()] })

/** Lines of an invoice as return lines: priced as sold, qty 0 until the user types what came back. */
const linesFromInvoice = (inv: SalesInvoice): RLine[] =>
  inv.lines.map((l) => ({ key: newKey(), productId: l.productId, qty: 0, freeQty: 0, unitPrice: l.unitPrice, discPct: l.discPct, sold: l.qty + l.freeQty }))

function toDraft(r: SalesReturn, inv: SalesInvoice | null): RDraft {
  const sold = new Map<number, number>()
  inv?.lines.forEach((l) => sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty + l.freeQty))
  return {
    customerId: r.customerId,
    date: r.date,
    salesInvoiceId: r.salesInvoiceId,
    reason: r.reason,
    restock: r.restock,
    billDiscPct: r.billDiscPct,
    refunded: r.refunded,
    refundMethod: (r.refundMethod || 'Cash') as RefundMethod,
    notes: r.notes,
    lines: r.lines.map((l) => ({ key: newKey(), productId: l.productId, qty: l.qty, freeQty: l.freeQty, unitPrice: l.unitPrice, discPct: l.discPct, sold: inv ? sold.get(l.productId) : undefined })),
  }
}

interface InvOption { id: number; invoiceNo: string; date: string; netTotal: number; due: number }

export function ReturnEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const [search] = useSearchParams()
  const presetInvoice = Number(search.get('invoice')) || null
  const presetCustomer = Number(search.get('customer')) || null
  const existing = useQuery({ queryKey: ['sales-returns', id], queryFn: () => api.get<SalesReturn>(`/sales-returns/${id}`), enabled: !!id })
  // the invoice the return is (or will be) against — for the "sold" column and the prices as sold
  const invId = existing.data?.salesInvoiceId ?? (id ? null : presetInvoice)
  const invoice = useQuery({ queryKey: ['sales', String(invId)], queryFn: () => api.get<SalesInvoice>(`/sales/${invId}`), enabled: !!invId })
  const { data: settings } = useSettings()
  const save = useApiMutation(
    ({ body }: { body: unknown }) => (id ? api.put<{ id: number; invoiceNo: string }>(`/sales-returns/${id}`, body) : api.post<{ id: number; invoiceNo: string }>('/sales-returns', body)),
    { success: (r) => `Return ${r.invoiceNo} saved`, onSuccess: (r) => nav(`/sales/returns/${r.id}`, { replace: true }) },
  )

  if ((id && existing.isLoading) || (invId && invoice.isLoading)) return <Spinner />
  if (id && existing.error) return <div><PageHeader title="Edit sales return" back={{ to: '/sales/returns', label: 'Sales returns' }} /><ErrorBox error={existing.error} /></div>
  const r = existing.data
  const inv = invoice.data ?? null
  const initial: RDraft = r
    ? toDraft(r, inv)
    : inv
      ? { ...emptyDraft(), customerId: inv.customerId, salesInvoiceId: inv.id, billDiscPct: inv.billDiscPct, lines: linesFromInvoice(inv) }
      : { ...emptyDraft(), customerId: presetCustomer }
  const returnNo = r?.returnNo ?? `${settings?.invoicePrefix ?? ''}R${String(settings?.nextReturnNo ?? 1).padStart(6, '0')}`

  return (
    <div>
      <PageHeader
        title={r ? `Edit ${r.returnNo}` : 'New sales return'}
        subtitle={r ? `${r.customerName} · ${r.date}` : `Will be ${returnNo} · goods a customer sends back, priced as they were sold`}
        back={{ to: r ? `/sales/returns/${r.id}` : inv ? `/sales/${inv.id}` : '/sales/returns', label: r ? r.returnNo : inv ? inv.invoiceNo : 'Sales returns' }}
      />
      <ReturnEditor
        key={`${r?.id ?? 'new'}-${inv?.id ?? 0}`}
        initial={initial}
        invoice={inv}
        isEditing={!!r}
        submitting={save.isPending}
        returnNo={returnNo}
        onCancel={() => nav(-1)}
        onSubmit={(d) =>
          save.mutateAsync({
            body: {
              date: d.date, customerId: d.customerId, salesInvoiceId: d.salesInvoiceId, reason: d.reason, restock: d.restock, billDiscPct: d.billDiscPct,
              refunded: d.refunded, refundMethod: d.refunded > 0 ? d.refundMethod : '', notes: d.notes,
              lines: d.lines.map(({ productId, qty, freeQty, unitPrice, discPct }) => ({ productId, qty, freeQty, unitPrice, discPct })),
            },
          })
        }
      />
    </div>
  )
}

function ReturnEditor({ initial, invoice, isEditing, submitting, returnNo, onCancel, onSubmit }: {
  initial: RDraft
  /** invoice the return starts against (prefilled lines); the user can still switch to another invoice or none */
  invoice: SalesInvoice | null
  isEditing: boolean
  submitting: boolean
  returnNo: string
  onCancel: () => void
  onSubmit: (d: RDraft) => Promise<unknown>
}) {
  const confirm = useConfirm()
  const { data: products = [] } = useProductOptions()
  const { data: customers = [] } = useCustomerOptions()
  const { data: ctx } = usePricingContext()
  const [d, setD] = useState<RDraft>(initial)
  const [linked, setLinked] = useState<SalesInvoice | null>(invoice)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState(false)
  const [loadingInv, setLoadingInv] = useState(false)
  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const customer = customers.find((c) => c.id === d.customerId)
  const partyList = customers.filter((c) => c.active || c.id === d.customerId)
  // this customer's invoices, newest first, to pick the one the goods were sold on
  const invoices = useQuery({
    queryKey: ['sales', 'for-return', d.customerId],
    queryFn: () => api.get<Paged<InvOption>>('/sales', { customerId: d.customerId!, pageSize: 200, sort: 'date', dir: 'desc' }),
    enabled: !!d.customerId,
  })
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    if (JSON.stringify(d) === JSON.stringify(initial)) return
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [d, initial])

  const set = (patch: Partial<RDraft>) => setD((x) => ({ ...x, ...patch }))
  const setLine = (key: string, patch: Partial<RLine>) => setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))
  const validLines = d.lines.filter((l) => l.productId && l.qty + l.freeQty > 0)
  const t = invoiceTotals(validLines, d.billDiscPct)
  const credited = Math.max(t.netTotal - d.refunded, 0)
  const over = validLines.filter((l) => l.sold != null && l.qty + l.freeQty > l.sold)

  const chooseCustomer = (cid: number) => {
    setLinked(null)
    set({ customerId: cid, salesInvoiceId: null, lines: d.salesInvoiceId ? [blank()] : d.lines })
    setErrors((e) => ({ ...e, customer: '' }))
  }
  /** picks the invoice the goods were sold on and fills its lines (qty 0) priced as sold */
  const chooseInvoice = async (sid: number | null) => {
    if (!sid) {
      setLinked(null)
      set({ salesInvoiceId: null, lines: [blank()] })
      return
    }
    setLoadingInv(true)
    try {
      const inv = await api.get<SalesInvoice>(`/sales/${sid}`)
      setLinked(inv)
      set({ salesInvoiceId: inv.id, billDiscPct: inv.billDiscPct, lines: linesFromInvoice(inv) })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoadingInv(false)
    }
  }
  /** a free-form line: price the item as this customer would have been charged (editable) */
  const chooseProduct = (key: string, pid: number) => {
    const p = pmap.get(pid)
    if (!p) return
    const q = ctx ? quotePrice({ product: p, customer: customer ?? null, ...ctx, qty: 1, date: d.date }) : null
    setLine(key, { productId: pid, unitPrice: q?.unitPrice ?? p.sellPrice, discPct: q?.discPct ?? 0 })
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!d.customerId) e.customer = 'Choose the customer who sent the goods back'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) e.date = 'Enter the date'
    if (!validLines.length) e.lines = 'Enter the quantity that came back on at least one item'
    d.lines.forEach((l, i) => {
      if (l.productId && l.sold != null && l.qty + l.freeQty > l.sold) e[`line${l.key}`] = `Line ${i + 1}: only ${l.sold} were sold on ${linked?.invoiceNo ?? 'that invoice'}`
      if (l.unitPrice < 0) e[`line${l.key}`] = `Line ${i + 1}: price cannot be negative`
      if (l.discPct < 0 || l.discPct > 100) e[`line${l.key}`] = `Line ${i + 1}: discount must be 0–100`
    })
    if (d.refunded > t.netTotal + 0.004) e.refunded = 'Refund cannot be more than the return total'
    setErrors(e)
    return Object.values(e).filter(Boolean)
  }

  const submit = async () => {
    const problems = validate()
    if (problems.length) {
      toast.error(problems[0])
      document.querySelector('[data-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const ok = await confirm({
      title: isEditing ? 'Save changes to this return?' : 'Record this sales return?',
      confirmText: 'Save return',
      message: (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-stone-500">Customer</dt><dd className="font-medium">{customer?.name}</dd>
          {linked && <><dt className="text-stone-500">Against</dt><dd>{linked.invoiceNo}</dd></>}
          <dt className="text-stone-500">Items</dt><dd>{validLines.length} lines · {qtyFmt(t.units + t.freeUnits)} units {d.restock ? 'back into stock' : 'written off (stock unchanged)'}</dd>
          <dt className="text-stone-500">Return total</dt><dd className="font-semibold">Rs {rs(t.netTotal)}</dd>
          {d.refunded > 0 && <><dt className="text-stone-500">Refunded</dt><dd>Rs {rs(d.refunded)} ({d.refundMethod})</dd></>}
          <dt className="text-stone-500">Off the balance</dt><dd>Rs {rs(credited)}</dd>
        </dl>
      ),
    })
    if (!ok) return
    try {
      await onSubmit({ ...d, lines: validLines })
    } catch {
      /* toast shown by the mutation */
    }
  }

  const productLabel = (p: ProductOption) => `${p.size} ${p.name}`
  const invOptions = invoices.data?.items ?? []

  return (
    <div className="space-y-4 pb-28 lg:pb-0">
      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Customer *" className="sm:col-span-2 lg:col-span-1" error={errors.customer}>
          <div data-error={!!errors.customer}>
            <Combobox
              items={partyList as CustomerOption[]}
              value={d.customerId}
              onChange={chooseCustomer}
              getId={(c) => c.id}
              getLabel={(c) => c.name}
              getSearch={(c) => `${c.code} ${c.name} ${c.area} ${c.typeName}`}
              placeholder="Search shop / customer…"
              disabled={isEditing}
              renderItem={(c) => (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-stone-500">{c.typeName}{c.area ? ` · ${c.area}` : ''}</span>
                  </span>
                  {c.balance > 0.004 && <Badge tone="amber">owes {rs(c.balance)}</Badge>}
                </div>
              )}
            />
          </div>
          {customer && (
            <span className="mt-1 flex flex-wrap gap-1.5 text-xs">
              <Badge tone="blue">{customer.typeName}</Badge>
              {customer.balance > 0.004 ? <Badge tone="amber">Balance Rs {rs(customer.balance)}</Badge> : customer.balance < -0.004 ? <Badge tone="green">Has credit Rs {rs(-customer.balance)}</Badge> : null}
            </span>
          )}
        </Field>
        <Field label="Against invoice" hint={linked ? `Items and prices as sold on ${linked.invoiceNo} · ${linked.date}` : 'Optional — pick the invoice the goods were sold on'}>
          <select className="input" value={d.salesInvoiceId ?? ''} onChange={(e) => chooseInvoice(Number(e.target.value) || null)} disabled={!d.customerId || loadingInv}>
            <option value="">No invoice (general return)</option>
            {invOptions.map((i) => <option key={i.id} value={i.id}>{i.invoiceNo} · {i.date} · Rs {rs(i.netTotal)}{i.due > 0.004 ? ` · due ${rs(i.due)}` : ''}</option>)}
            {linked && !invOptions.some((i) => i.id === linked.id) && <option value={linked.id}>{linked.invoiceNo} · {linked.date}</option>}
          </select>
        </Field>
        <Field label="Date" error={errors.date}>
          <input data-error={!!errors.date} type="date" className="input" value={d.date} onChange={(e) => { set({ date: e.target.value }); setErrors((x) => ({ ...x, date: '' })) }} />
        </Field>
        <Field label="Reason">
          <select className="input" value={d.reason} onChange={(e) => set({ reason: e.target.value as ReturnReason })}>
            {RETURN_REASONS.map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="What happens to the goods" className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm ${d.restock ? 'border-brand-400 bg-brand-50' : 'border-stone-200'}`}>
              <input type="radio" className="mt-0.5 accent-brand-700" checked={d.restock} onChange={() => set({ restock: true })} />
              <span>Back into stock <span className="block text-xs text-stone-500">Good condition — can be sold again</span></span>
            </label>
            <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm ${!d.restock ? 'border-amber-400 bg-amber-50' : 'border-stone-200'}`}>
              <input type="radio" className="mt-0.5 accent-brand-700" checked={!d.restock} onChange={() => set({ restock: false })} />
              <span>Write off <span className="block text-xs text-stone-500">Damaged or expired — stock does not change</span></span>
            </label>
          </div>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <input className="input" value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional" />
        </Field>
      </div>

      {/* lines */}
      <div className="card">
        <div className="hidden grid-cols-[1.5rem_minmax(160px,1fr)_3.5rem_3.75rem_3.75rem_6rem_4rem_6rem_2rem] gap-1.5 border-b border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold tracking-wide text-stone-500 uppercase md:grid xl:gap-2">
          <span>#</span><span>Item</span><span className="text-right">{linked ? 'Sold' : ''}</span><span className="text-right">Qty</span><span className="text-right">Free</span><span className="text-right">Unit price</span><span className="text-right">Disc %</span><span className="text-right">Amount</span><span />
        </div>
        <ul className="divide-y divide-stone-100">
          {d.lines.map((l, i) => {
            const p = l.productId ? pmap.get(l.productId) : undefined
            const err = errors[`line${l.key}`]
            const tooMany = l.sold != null && l.qty + l.freeQty > l.sold
            return (
              <li key={l.key} className={`px-3 py-3 md:py-2 ${l.sold != null && l.qty + l.freeQty === 0 ? 'opacity-70' : ''}`} data-error={!!err}>
                <div className="grid grid-cols-4 items-start gap-2 md:grid-cols-[1.5rem_minmax(160px,1fr)_3.5rem_3.75rem_3.75rem_6rem_4rem_6rem_2rem] md:items-center md:gap-1.5 xl:gap-2">
                  <span className="hidden text-sm text-stone-400 md:block">{i + 1}</span>
                  <div className="col-span-3 md:col-span-1">
                    {linked ? (
                      <span className="block truncate text-sm font-medium">{p ? productLabel(p) : `Item #${l.productId}`}</span>
                    ) : (
                      <Combobox
                        items={products.filter((x) => x.active || x.id === l.productId)}
                        value={l.productId}
                        onChange={(pid) => chooseProduct(l.key, pid)}
                        getId={(x) => x.id}
                        getLabel={productLabel}
                        getSearch={(x) => `${x.code} ${x.size} ${x.name}`}
                        placeholder="Search code or name…"
                        autoFocus={i > 0 && i === d.lines.length - 1 && !l.productId}
                        renderItem={(x) => (
                          <div className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate"><span className="font-medium">{productLabel(x)}</span> <span className="text-xs text-stone-400">{x.code}</span></span>
                            <span className="shrink-0 text-xs text-stone-500 tabular-nums">{x.onHand} in stock</span>
                          </div>
                        )}
                      />
                    )}
                  </div>
                  <div className="flex justify-end md:contents">
                    {!linked && (
                      <button className="btn-ghost p-2 text-stone-400 hover:text-red-600 max-md:min-h-10 max-md:min-w-10 md:order-last" onClick={() => setD((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((y) => y.key !== l.key) : [blank()] }))} aria-label="Remove line">
                        <Trash2 size={16} />
                      </button>
                    )}
                    {linked && <span className="hidden md:order-last md:block" />}
                  </div>
                  <span className={`hidden text-right text-sm tabular-nums md:block ${tooMany ? 'font-semibold text-red-600' : 'text-stone-500'}`}>{l.sold ?? ''}</span>
                  <MobileLabel label="Qty"><NumberInput aria-label="Qty" min={0} step={1} className="px-2 py-1.5" value={l.qty} onChange={(v) => setLine(l.key, { qty: Math.max(0, Math.round(v ?? 0)) })} /></MobileLabel>
                  <MobileLabel label="Free"><NumberInput aria-label="Free qty" min={0} step={1} className="px-2 py-1.5" value={l.freeQty} onChange={(v) => setLine(l.key, { freeQty: Math.max(0, Math.round(v ?? 0)) })} /></MobileLabel>
                  <MobileLabel label="Price"><NumberInput aria-label="Unit price" min={0} step="0.01" className="px-2 py-1.5" value={l.unitPrice} onChange={(v) => setLine(l.key, { unitPrice: Math.max(0, v ?? 0) })} /></MobileLabel>
                  <MobileLabel label="Disc %"><NumberInput aria-label="Discount %" min={0} max={100} step="0.01" className="px-2 py-1.5" value={l.discPct} onChange={(v) => setLine(l.key, { discPct: Math.min(100, Math.max(0, v ?? 0)) })} /></MobileLabel>
                  <div className="col-span-4 flex items-center justify-between md:col-span-1 md:block md:text-right">
                    <span className="text-xs text-stone-500 md:hidden">Amount</span>
                    <span className="font-semibold tabular-nums">{rs(lineNet(l))}</span>
                  </div>
                </div>
                {(p || err || l.sold != null) && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 md:pl-9">
                    {p && <span className="font-mono">{p.code}</span>}
                    {l.sold != null && <span className={`md:hidden ${tooMany ? 'font-semibold text-red-600' : ''}`}>Sold {l.sold}</span>}
                    {tooMany && <span className="font-medium text-red-600">more than were sold</span>}
                    {err && <span className="font-medium text-red-600">{err}</span>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 p-3">
          {linked ? (
            <span className="text-sm text-stone-500">Type the quantity that came back on each line — lines left at 0 are not returned.</span>
          ) : (
            <button className="btn-secondary" onClick={() => setD((x) => ({ ...x, lines: [...x.lines, blank()] }))}><Plus size={16} /> Add item</button>
          )}
          {errors.lines && <span className="text-sm font-medium text-red-600" data-error="true">{errors.lines}</span>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {over.length > 0 && <Warn>{over.length} line(s) take back more than {linked?.invoiceNo} sold.</Warn>}
          {!d.restock && validLines.length > 0 && <Warn>These goods are written off: stock will not change and the cost is lost.</Warn>}
          {customer && credited > 0 && customer.balance - credited < -0.004 && <Warn>{customer.name} will have Rs {rs(credited - Math.max(customer.balance, 0))} credit with you after this return — use it on the next invoice or refund it in cash.</Warn>}
        </div>
        <div className="card hidden space-y-2 p-4 text-sm lg:block">
          <Totals t={t} d={d} credited={credited} set={set} refundError={errors.refunded} />
          <div className="flex gap-2 pt-2">
            <button className="btn-secondary flex-1" onClick={onCancel} disabled={submitting}>Cancel</button>
            <button className="btn-primary flex-1" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save return
            </button>
          </div>
          <button className="btn-secondary w-full" onClick={() => setPreview(true)}><Eye size={16} /> Preview / print draft</button>
        </div>
      </div>

      {/* phones & tablets: sticky totals bar */}
      <div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)] lg:hidden">
        <details className="group">
          <summary className="cursor-pointer list-none py-1 text-sm">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 text-xs text-stone-500">
                <span className="block">{validLines.length} items · gross <span className="tabular-nums text-stone-700">Rs {rs(t.gross)}</span></span>
                <span className="block text-amber-700">Discount <span className="tabular-nums">Rs {rs(t.lineDiscount + t.billDiscount)}</span>{t.gross ? ` (${(((t.lineDiscount + t.billDiscount) / t.gross) * 100).toFixed(1)}%)` : ''}</span>
              </div>
              <div className="shrink-0 text-right">
                <span className="block text-[11px] text-stone-500 uppercase">Return total</span>
                <span className="block text-lg leading-tight font-semibold tabular-nums">Rs {rs(t.netTotal)}</span>
              </div>
            </div>
            <span className="block text-[11px] text-stone-400">tap for bill discount %, refund and what comes off the balance</span>
          </summary>
          <div className="space-y-2 border-t border-stone-100 py-2 text-sm">
            <Totals t={t} d={d} credited={credited} set={set} refundError={errors.refunded} />
          </div>
        </details>
        <div className="mt-2 grid grid-cols-[auto_1fr_1fr] gap-2">
          <button className="btn-secondary" onClick={() => setPreview(true)} aria-label="Preview"><Eye size={16} /></button>
          <button className="btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
          </button>
        </div>
      </div>

      <PrintPreview open={preview} onClose={() => setPreview(false)} title={returnNo}>
        <ReturnDocument
          returnNo={`${returnNo}${isEditing ? '' : ' (draft)'}`}
          r={{ date: d.date, invoiceNo: linked?.invoiceNo ?? null, reason: d.reason, restock: d.restock, notes: d.notes, billDiscPct: d.billDiscPct, refunded: d.refunded, refundMethod: d.refunded > 0 ? d.refundMethod : '' }}
          party={customer ? { code: customer.code, name: customer.name, type: customer.typeName, address: customer.area } : undefined}
          lines={validLines.map((l) => ({ ...l, productId: l.productId!, ...pmap.get(l.productId!) }))}
        />
      </PrintPreview>
    </div>
  )
}

function Totals({ t, d, credited, set, refundError }: { t: ReturnType<typeof invoiceTotals>; d: RDraft; credited: number; set: (p: Partial<RDraft>) => void; refundError?: string }) {
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
        <Row label="Return total" strong big>{rs(t.netTotal)}</Row>
      </div>
      <div className="flex items-center justify-between gap-3" data-error={!!refundError}>
        <span className="text-stone-500">Refunded in cash</span>
        <NumberInput aria-label="Refunded now" min={0} step="0.01" className="w-36 py-1" value={d.refunded} onChange={(v) => set({ refunded: Math.max(0, v ?? 0) })} />
      </div>
      {d.refunded > 0 && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-stone-500">Refund method</span>
          <select className="input w-36 py-1" value={d.refundMethod} onChange={(e) => set({ refundMethod: e.target.value as RefundMethod })} aria-label="Refund method">
            {REFUND_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
      )}
      {refundError && <p className="text-xs text-red-600">{refundError}</p>}
      <Row label="Off the customer's balance" strong>{rs(credited)}</Row>
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

/** Printable credit note, laid out like the invoices. */
function ReturnDocument({ returnNo, r, party, lines }: {
  returnNo: string
  r: { date: string; invoiceNo: string | null; reason: string; restock: boolean; notes: string; billDiscPct: number; refunded: number; refundMethod: string }
  party?: { code?: string; name?: string; type?: string; address?: string }
  lines: Parameters<typeof InvoiceDocument>[0]['lines']
}) {
  const { data: settings } = useSettings()
  return (
    <InvoiceDocument
      title="SALES RETURN"
      issuer={settings ?? { name: '' }}
      party={party}
      partyLabel="Customer"
      meta={[['Return No', returnNo], ['Date', r.date], ['Against invoice', r.invoiceNo ?? ''], ['Reason', r.reason], ['Goods', r.restock ? 'Back into stock' : 'Written off'], ['Refund', r.refunded > 0 ? `${rs(r.refunded)} ${r.refundMethod}`.trim() : ''], ['Notes', r.notes]]}
      lines={lines}
      billDiscPct={r.billDiscPct}
      paidAmount={r.refunded}
      paidLabel="Refunded"
      balanceLabel="Credited to account"
      signatures={['Prepared by', 'Received by', 'Customer']}
      footer={settings?.footerNote}
    />
  )
}

// ================================================================ view

export function ReturnView() {
  const { id } = useParams()
  const nav = useNavigate()
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['sales-returns', id], queryFn: () => api.get<SalesReturn>(`/sales-returns/${id}`) })
  const { data: customers = [] } = useCustomerOptions()
  const [preview, setPreview] = useState(false)
  const del = useApiMutation(() => api.del(`/sales-returns/${id}`), { success: 'Return deleted', onSuccess: () => nav('/sales/returns', { replace: true }) })

  const r = q.data
  const cust = customers.find((c) => c.id === r?.customerId)
  const doc = useMemo(
    () => r && <ReturnDocument returnNo={r.returnNo} r={r} party={{ code: cust?.code, name: r.customerName, type: r.customerTypeName, address: cust?.area }} lines={r.lines} />,
    [r, cust],
  )
  if (q.isLoading) return <Spinner />
  if (q.error || !r) return <div><PageHeader title="Sales return" back={{ to: '/sales/returns', label: 'Sales returns' }} /><ErrorBox error={q.error ?? 'Not found'} onRetry={() => q.refetch()} /></div>

  const units = r.lines.reduce((s, l) => s + l.qty + l.freeQty, 0)
  return (
    <div>
      <PageHeader
        title={r.returnNo}
        back={{ to: '/sales/returns', label: 'Sales returns' }}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link className="hover:underline" to={`/customers/${r.customerId}`}>{r.customerName}</Link> · {r.date}
            {r.salesInvoiceId && <>· against <Link className="text-brand-700 hover:underline" to={`/sales/${r.salesInvoiceId}`}>{r.invoiceNo}</Link></>}
            <Badge tone={r.restock ? 'green' : 'amber'}>{r.restock ? 'Back in stock' : 'Written off'}</Badge>
          </span>
        }
        actions={
          <>
            <button
              className="btn-danger"
              disabled={del.isPending}
              onClick={async () =>
                (await confirm({ title: `Delete ${r.returnNo}?`, message: r.restock ? 'The items leave stock again and the amount goes back on the customer\'s balance. This cannot be undone.' : 'The amount goes back on the customer\'s balance. This cannot be undone.', confirmText: 'Delete return', tone: 'danger' })) && del.mutate(undefined)
              }
            >
              <Trash2 size={15} /> Delete
            </button>
            <Link to={`/sales/returns/${r.id}/edit`} className="btn-secondary"><Pencil size={15} /> Edit</Link>
            <button className="btn-secondary hidden sm:inline-flex" onClick={() => quickPrint(r.returnNo)}><Printer size={15} /> Quick print</button>
            <button className="btn-primary" onClick={() => setPreview(true)}><Eye size={15} /> Print preview</button>
          </>
        }
      />
      <div className="no-print mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Return total" value={`Rs ${rs(r.netTotal)}`} hint={`${r.lines.length} lines · ${qtyFmt(units)} units`} />
        <Stat label="Refunded in cash" value={`Rs ${rs(r.refunded)}`} hint={r.refunded ? r.refundMethod : 'nothing refunded'} tone={r.refunded ? 'warn' : 'default'} />
        <Stat label="Off the balance" value={`Rs ${rs(r.credited)}`} hint={r.salesInvoiceId ? `applied to ${r.invoiceNo}` : 'applied to the oldest unpaid invoices'} tone="good" />
        <Stat label="Goods" value={r.restock ? 'Back in stock' : 'Written off'} hint={r.restock ? `cost Rs ${rs(r.costTotal)} back in stock` : `cost Rs ${rs(r.costTotal)} lost`} tone={r.restock ? 'default' : 'bad'} />
      </div>
      <p className="no-print mb-3 text-sm text-stone-500">Reason: <Badge>{r.reason}</Badge>{r.notes ? <span className="ml-2">{r.notes}</span> : null}</p>
      {doc}
      <PrintPreview open={preview} onClose={() => setPreview(false)} title={r.returnNo}>{doc}</PrintPreview>
    </div>
  )
}

