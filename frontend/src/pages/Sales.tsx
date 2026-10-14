import { useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, Pencil, Plus, Printer, ScanLine, Trash2, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { qtyFmt, rs, type SalesInvoice } from '@pjd/shared'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column } from '../components/DataTable'
import InvoiceDocument from '../components/InvoiceDocument'
import InvoiceEditor, { blankLine, emptyDraft, type Draft } from '../components/InvoiceEditor'
import { ScanReview, ScanUpload, scanToDraft, type ScanState } from '../components/InvoiceScan'
import PrintPreview from '../components/PrintPreview'
import { Badge, ErrorBox, Filters, PageHeader, SearchBox, Spinner, Stat, StatusBadge } from '../components/ui'
import { api, fetchAll } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { useApiMutation, useCustomerOptions, useCustomerTypes, useListState, usePaged, useProductOptions, useSettings } from '../lib/hooks'
import { PaymentModal } from './Payments'

interface SaleRow {
  id: number
  invoiceNo: string
  date: string
  payMethod: string
  netTotal: number
  costTotal: number
  customerId: number
  partyName: string
  area: string
  typeName: string
  paid: number
  due: number
  status: SalesInvoice['status']
  dueDate: string
  overdue: boolean
}

export function SalesList() {
  const [s, set] = useListState({ from: '', to: '', status: '', typeId: '', customerId: '', sort: 'date', dir: 'desc' as const })
  const { data: types = [] } = useCustomerTypes()
  const { data: customers = [] } = useCustomerOptions()
  const q = usePaged<SaleRow, { count: number; netTotal: number; due: number; profit: number }>('sales', '/sales', s)

  const columns: Column<SaleRow>[] = [
    { key: 'no', header: 'Invoice', sortKey: 'invoiceNo', render: (r) => <Link to={`/sales/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.invoiceNo}</Link> },
    { key: 'date', header: 'Date', sortKey: 'date', render: (r) => <span className="text-stone-500">{r.date}</span> },
    { key: 'party', header: 'Customer', sortKey: 'party', render: (r) => <span>{r.partyName}<span className="ml-1.5 text-xs text-stone-400">{r.typeName}</span></span> },
    { key: 'area', header: 'Area', hideBelow: 'xl', render: (r) => <span className="text-stone-500">{r.area}</span>, mobile: false },
    { key: 'method', header: 'Method', hideBelow: 'lg', render: (r) => <span className="text-stone-500">{r.payMethod}</span> },
    { key: 'net', header: 'Net total', sortKey: 'netTotal', align: 'right', render: (r) => <span className="font-medium">{rs(r.netTotal)}</span> },
    { key: 'due', header: 'Due', sortKey: 'due', align: 'right', render: (r) => (r.due > 0 ? rs(r.due) : <span className="text-stone-300">—</span>) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.overdue} /> },
  ]

  const exportExcel = async () => {
    const all = await fetchAll<SaleRow>('/sales', { ...s, page: undefined, pageSize: undefined })
    await downloadExcel('sales', [{
      name: 'Sales invoices',
      columns: [
        { header: 'Invoice' }, { header: 'Date', type: 'date' }, { header: 'Customer' }, { header: 'Customer type' }, { header: 'Area' },
        { header: 'Method' }, { header: 'Net total', type: 'money' }, { header: 'Cost', type: 'money' }, { header: 'Profit', type: 'money' },
        { header: 'Paid', type: 'money' }, { header: 'Due', type: 'money' }, { header: 'Status' }, { header: 'Due date', type: 'date' },
      ],
      rows: all.map((r) => [r.invoiceNo, r.date, r.partyName, r.typeName, r.area, r.payMethod, r.netTotal, r.costTotal, r.netTotal - r.costTotal, r.paid, r.due, r.overdue ? 'Overdue' : r.status === 'paid' ? 'Paid' : r.status === 'partial' ? 'Part paid' : 'Unpaid', r.dueDate]),
      totals: [6, 7, 8, 9, 10],
    }])
  }

  const sum = q.data?.summary
  return (
    <div>
      <PageHeader
        title="Sales invoices"
        subtitle="Sales to shops, medical centers and walk-in customers"
        actions={
          <>
            <button className="btn-secondary" onClick={exportExcel}><FileSpreadsheet size={16} /> Excel</button>
            <Link to="/sales/new" className="btn-secondary"><ScanLine size={16} /> Scan invoice image</Link>
            <Link to="/sales/new" className="btn-primary"><Plus size={16} /> New sale</Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Invoices" value={qtyFmt(sum?.count)} />
        <Stat label="Net sales" value={`Rs ${rs(sum?.netTotal)}`} />
        <Stat label="Gross profit" value={`Rs ${rs(sum?.profit)}`} tone="good" />
        <Stat label="Still to collect" value={`Rs ${rs(sum?.due)}`} tone={sum?.due ? 'warn' : 'default'} />
      </div>
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Invoice no, customer, area…" />
        <select className="input" value={s.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="due">Unpaid / part paid</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>
        <select className="input" value={s.typeId} onChange={(e) => set({ typeId: e.target.value })}>
          <option value="">All customer types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
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
        rowLink={(r) => `/sales/${r.id}`}
        empty={<>No sales found. <Link to="/sales/new" className="font-medium text-brand-700 hover:underline">Create an invoice</Link></>}
        mobileCard={(r) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-brand-700">{r.invoiceNo}</span>
              <span className="font-semibold tabular-nums">Rs {rs(r.netTotal)}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{r.partyName}</span>
              <StatusBadge status={r.status} overdue={r.overdue} />
            </div>
            <div className="mt-0.5 flex justify-between text-xs text-stone-500">
              <span>{r.date} · {r.typeName}</span>
              {r.due > 0 && <span>due Rs {rs(r.due)}</span>}
            </div>
          </div>
        )}
      />
    </div>
  )
}

function toDraft(inv: SalesInvoice): Draft {
  return {
    ...emptyDraft('sale'),
    partyId: inv.customerId,
    date: inv.date,
    payMethod: inv.payMethod,
    billDiscPct: inv.billDiscPct,
    paidOnInvoice: inv.paidOnInvoice,
    paidTouched: true,
    notes: inv.notes,
    lines: inv.lines.map((l) => ({ ...blankLine(), productId: l.productId, qty: l.qty, freeQty: l.freeQty, unitPrice: l.unitPrice, discPct: l.discPct, manualPrice: true, manualFree: true, priceNote: 'Saved price' })),
  }
}

export function SaleEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const [search] = useSearchParams()
  const presetCustomer = Number(search.get('customer')) || null
  const existing = useQuery({ queryKey: ['sales', id], queryFn: () => api.get<SalesInvoice>(`/sales/${id}`), enabled: !!id })
  const { data: settings } = useSettings()
  const { data: customers = [] } = useCustomerOptions()
  const [scan, setScan] = useState<ScanState | null>(null)
  const [scanNo, setScanNo] = useState(0)
  const save = useApiMutation(
    ({ body }: { body: unknown }) => (id ? api.put<{ id: number; invoiceNo: string }>(`/sales/${id}`, body) : api.post<{ id: number; invoiceNo: string }>('/sales', body)),
    { success: (r) => `Invoice ${r.invoiceNo} saved`, onSuccess: (r) => nav(`/sales/${r.id}`, { replace: true }) },
  )

  if (id && existing.isLoading) return <Spinner />
  if (id && existing.error) return <ErrorBox error={existing.error} />
  const inv = existing.data
  const invoiceNo = inv?.invoiceNo ?? `${settings?.invoicePrefix ?? ''}${String(settings?.nextInvoiceNo ?? 1).padStart(6, '0')}`
  const onScanned = (s: ScanState) => { setScan(s); setScanNo((n) => n + 1) }
  const ownQty = new Map<number, number>()
  inv?.lines.forEach((l) => ownQty.set(l.productId, (ownQty.get(l.productId) ?? 0) + l.qty + l.freeQty))

  return (
    <div>
      <PageHeader title={inv ? `Edit ${inv.invoiceNo}` : 'New sales invoice'} subtitle={inv ? `${inv.customerName} · ${inv.date}` : 'Prices fill in from the customer type, product price rules and promotions'} back={{ to: inv ? `/sales/${inv.id}` : '/sales', label: inv ? inv.invoiceNo : 'Sales' }} />
      {!inv && (scan ? <ScanReview scan={scan} kind="sale" onScanned={onScanned} onClear={() => { setScan(null); setScanNo((n) => n + 1) }} /> : <ScanUpload kind="sale" onScanned={onScanned} />)}
      <InvoiceEditor
        key={`${inv?.id ?? 'new'}-${scanNo}`}
        mode="sale"
        initial={inv ? toDraft(inv) : scan ? scanToDraft(scan.result, { ...emptyDraft('sale'), partyId: presetCustomer }) : { ...emptyDraft('sale'), partyId: presetCustomer }}
        scanned={!!scan && !inv}
        printedTotal={!inv ? scan?.result.printedNetTotal ?? null : null}
        ownQty={ownQty}
        previousOutstanding={inv ? inv.netTotal - inv.paidOnInvoice : 0}
        submitting={save.isPending}
        onCancel={() => nav(-1)}
        invoiceNoPreview={invoiceNo}
        onSubmit={(d, paid) =>
          save.mutateAsync({
            body: { customerId: d.partyId, date: d.date, payMethod: d.payMethod, billDiscPct: d.billDiscPct, paidOnInvoice: paid, notes: d.notes, lines: d.lines.map(({ productId, qty, freeQty, unitPrice, discPct }) => ({ productId, qty, freeQty, unitPrice, discPct })) },
          })
        }
        renderPreview={(d, paid) => {
          const c = customers.find((x) => x.id === d.partyId)
          return (
            <PreviewDoc
              invoiceNo={invoiceNo + (inv ? '' : ' (draft)')}
              d={d}
              paid={paid}
              party={c ? { code: c.code, name: c.name, type: c.typeName, address: c.area } : undefined}
            />
          )
        }}
      />
    </div>
  )
}

function PreviewDoc({ invoiceNo, d, paid, party }: { invoiceNo: string; d: Draft; paid: number; party?: { code: string; name: string; type: string; address: string } }) {
  const { data: settings } = useSettings()
  const { data: products = [] } = useProductOptions()
  const pmap = new Map(products.map((p) => [p.id, p]))
  return (
    <InvoiceDocument
      title="INVOICE"
      issuer={settings ?? { name: '' }}
      party={party}
      partyLabel="Customer"
      meta={[['Invoice No', invoiceNo], ['Invoice Date', d.date], ['Pay. Method', d.payMethod], ['Notes', d.notes]]}
      lines={d.lines.map((l) => ({ ...l, productId: l.productId!, ...pmap.get(l.productId!) }))}
      billDiscPct={d.billDiscPct}
      paidAmount={paid}
      footer={settings?.footerNote}
    />
  )
}

export function SaleView() {
  const { id } = useParams()
  const nav = useNavigate()
  const confirm = useConfirm()
  const { data: settings } = useSettings()
  const q = useQuery({ queryKey: ['sales', id], queryFn: () => api.get<SalesInvoice>(`/sales/${id}`) })
  const { data: customers = [] } = useCustomerOptions()
  const [preview, setPreview] = useState(false)
  const [paying, setPaying] = useState(false)
  const del = useApiMutation(() => api.del(`/sales/${id}`), { success: 'Invoice deleted — stock returned', onSuccess: () => nav('/sales', { replace: true }) })

  const inv = q.data
  const cust = customers.find((c) => c.id === inv?.customerId)
  const doc = useMemo(
    () =>
      inv && (
        <InvoiceDocument
          title="INVOICE"
          issuer={settings ?? { name: '' }}
          party={{ code: cust?.code, name: inv.customerName, type: inv.customerTypeName, address: cust?.area }}
          partyLabel="Customer"
          meta={[['Invoice No', inv.invoiceNo], ['Invoice Date', inv.date], ['Pay. Method', inv.payMethod], ['Due Date', inv.payMethod === 'Credit' ? inv.dueDate : ''], ['Notes', inv.notes]]}
          lines={inv.lines}
          billDiscPct={inv.billDiscPct}
          paidAmount={inv.paid}
          footer={settings?.footerNote}
        />
      ),
    [inv, settings, cust],
  )
  if (q.isLoading) return <Spinner />
  if (q.error || !inv) return <ErrorBox error={q.error ?? 'Not found'} onRetry={() => q.refetch()} />

  const profit = inv.netTotal - inv.costTotal
  return (
    <div>
      <PageHeader
        title={inv.invoiceNo}
        back={{ to: '/sales', label: 'Sales' }}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Link className="hover:underline" to={`/customers/${inv.customerId}`}>{inv.customerName}</Link> · {inv.date} <StatusBadge status={inv.status} overdue={inv.overdue} /></span>}
        actions={
          <>
            <button
              className="btn-danger"
              disabled={del.isPending}
              onClick={async () =>
                (await confirm({ title: `Delete ${inv.invoiceNo}?`, message: 'The items go back into stock and the customer balance is reduced. This cannot be undone.', confirmText: 'Delete invoice', tone: 'danger' })) && del.mutate(undefined)
              }
            >
              <Trash2 size={15} /> Delete
            </button>
            <Link to={`/sales/${inv.id}/edit`} className="btn-secondary"><Pencil size={15} /> Edit</Link>
            {inv.due > 0 && <button className="btn-secondary" onClick={() => setPaying(true)}><Wallet size={15} /> Receive</button>}
            <button className="btn-secondary hidden sm:inline-flex" onClick={() => window.print()}><Printer size={15} /> Quick print</button>
            <button className="btn-primary" onClick={() => setPreview(true)}><Eye size={15} /> Print preview</button>
          </>
        }
      />
      <div className="no-print mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net total" value={`Rs ${rs(inv.netTotal)}`} />
        <Stat label="Paid" value={`Rs ${rs(inv.paid)}`} hint={inv.paidOnInvoice ? `Rs ${rs(inv.paidOnInvoice)} on invoice` : undefined} tone="good" />
        <Stat label="Due" value={`Rs ${rs(inv.due)}`} hint={inv.due > 0 ? `by ${inv.dueDate}` : undefined} tone={inv.overdue ? 'bad' : inv.due > 0 ? 'warn' : 'default'} />
        <Stat label="Gross profit" value={`Rs ${rs(profit)}`} hint={inv.netTotal ? `${((profit / inv.netTotal) * 100).toFixed(1)}% · cost Rs ${rs(inv.costTotal)}` : undefined} tone={profit < 0 ? 'bad' : 'good'} />
      </div>
      {inv.customerTypeName && <p className="no-print mb-3 text-sm text-stone-500">Customer type: <Badge tone="blue">{inv.customerTypeName}</Badge></p>}
      {doc}
      <PrintPreview open={preview} onClose={() => setPreview(false)} title={inv.invoiceNo}>{doc}</PrintPreview>
      {paying && <PaymentModal partyType="customer" partyId={inv.customerId} defaultAmount={inv.due} reference={inv.invoiceNo} onClose={() => setPaying(false)} />}
    </div>
  )
}
