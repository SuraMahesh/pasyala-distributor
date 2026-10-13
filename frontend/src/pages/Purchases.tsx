import { useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, Pencil, Plus, Printer, Trash2, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { rs, type PurchaseInvoice } from '@pjd/shared'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column } from '../components/DataTable'
import InvoiceDocument from '../components/InvoiceDocument'
import InvoiceEditor, { blankLine, emptyDraft, type Draft } from '../components/InvoiceEditor'
import PrintPreview from '../components/PrintPreview'
import { ErrorBox, Filters, PageHeader, SearchBox, Spinner, Stat, StatusBadge } from '../components/ui'
import { api, fetchAll } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { useApiMutation, useListState, usePaged, useProductOptions, useSettings, useSupplierOptions } from '../lib/hooks'
import { PaymentModal } from './Payments'

interface PurchaseRow {
  id: number
  invoiceNo: string
  orderNo: string
  date: string
  payMethod: string
  netTotal: number
  supplierId: number
  partyName: string
  lineCount: number
  units: number
  freeUnits: number
  paid: number
  due: number
  status: PurchaseInvoice['status']
  overdue: boolean
}

export function PurchaseList() {
  const [s, set] = useListState({ from: '', to: '', status: '', supplierId: '', sort: 'date', dir: 'desc' as const })
  const { data: suppliers = [] } = useSupplierOptions()
  const q = usePaged<PurchaseRow, { count: number; netTotal: number; due: number }>('purchases', '/purchases', s)
  const columns: Column<PurchaseRow>[] = [
    { key: 'no', header: 'Invoice no', sortKey: 'invoiceNo', render: (r) => <Link to={`/purchases/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.invoiceNo}</Link> },
    { key: 'date', header: 'Date', sortKey: 'date', render: (r) => <span className="text-stone-500">{r.date}</span> },
    { key: 'sup', header: 'Supplier', sortKey: 'party', render: (r) => r.partyName },
    { key: 'order', header: 'Order no', hideBelow: 'lg', render: (r) => <span className="text-stone-500">{r.orderNo}</span>, mobile: false },
    { key: 'items', header: 'Items', align: 'right', hideBelow: 'lg', render: (r) => r.lineCount },
    { key: 'units', header: 'Units (+free)', align: 'right', render: (r) => <>{r.units}{r.freeUnits ? <span className="text-brand-700"> +{r.freeUnits}</span> : ''}</> },
    { key: 'net', header: 'Net total', sortKey: 'netTotal', align: 'right', render: (r) => <span className="font-medium">{rs(r.netTotal)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.overdue} /> },
  ]
  return (
    <div>
      <PageHeader
        title="Purchases (GRN)"
        subtitle="Supplier invoices — every line adds qty + free qty to stock"
        actions={
          <>
            <button className="btn-secondary" onClick={async () => {
              const all = await fetchAll<PurchaseRow>('/purchases', { ...s, page: undefined, pageSize: undefined })
              await downloadExcel('purchases', [{
                name: 'Purchases',
                columns: [{ header: 'Invoice no' }, { header: 'Date' }, { header: 'Supplier' }, { header: 'Order no' }, { header: 'Lines', type: 'int' }, { header: 'Units', type: 'int' }, { header: 'Free units', type: 'int' }, { header: 'Net total', type: 'money' }, { header: 'Paid', type: 'money' }, { header: 'Due', type: 'money' }, { header: 'Status' }],
                rows: all.map((r) => [r.invoiceNo, r.date, r.partyName, r.orderNo, r.lineCount, r.units, r.freeUnits, r.netTotal, r.paid, r.due, r.status === 'paid' ? 'Paid' : r.overdue ? 'Overdue' : 'Due']),
                totals: [5, 6, 7, 8, 9],
              }])
            }}><FileSpreadsheet size={16} /> Excel</button>
            <Link to="/purchases/new" className="btn-primary"><Plus size={16} /> Enter supplier invoice</Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Invoices" value={q.data?.summary.count ?? 0} />
        <Stat label="Total" value={`Rs ${rs(q.data?.summary.netTotal)}`} />
        <Stat label="To pay" value={`Rs ${rs(q.data?.summary.due)}`} tone={q.data?.summary.due ? 'warn' : 'default'} />
      </div>
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Invoice no, order no…" />
        <select className="input" value={s.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
          <option value="">All suppliers</option>
          {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select className="input" value={s.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="due">Unpaid / part paid</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:w-auto">
          <input type="date" className="input" value={s.from} onChange={(e) => set({ from: e.target.value })} aria-label="From" />
          <span className="text-stone-400">to</span>
          <input type="date" className="input" value={s.to} onChange={(e) => set({ to: e.target.value })} aria-label="To" />
        </div>
      </Filters>
      <DataTable
        rows={q.data?.items ?? []}
        columns={columns}
        rowKey={(r) => r.id}
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
        rowLink={(r) => `/purchases/${r.id}`}
        empty="No purchases found."
      />
    </div>
  )
}

function toDraft(inv: PurchaseInvoice): Draft {
  return {
    ...emptyDraft('purchase'),
    partyId: inv.supplierId,
    date: inv.date,
    payMethod: inv.payMethod,
    billDiscPct: inv.billDiscPct,
    paidOnInvoice: inv.paidOnInvoice,
    paidTouched: true,
    notes: inv.notes,
    invoiceNo: inv.invoiceNo,
    orderNo: inv.orderNo,
    salesPerson: inv.salesPerson,
    lines: inv.lines.map((l) => ({ ...blankLine(), productId: l.productId, qty: l.qty, freeQty: l.freeQty, unitPrice: l.unitPrice, discPct: l.discPct, manualPrice: true, manualFree: true })),
  }
}

function PurchaseDoc({ inv, d, paid }: { inv?: PurchaseInvoice; d?: Draft; paid: number }) {
  const { data: settings } = useSettings()
  const { data: suppliers = [] } = useSupplierOptions()
  const { data: products = [] } = useProductOptions()
  const pmap = new Map(products.map((p) => [p.id, p]))
  const supplierId = inv?.supplierId ?? d?.partyId
  const sup = suppliers.find((s) => s.id === supplierId)
  const lines = inv?.lines ?? d!.lines.map((l) => ({ ...l, productId: l.productId!, ...pmap.get(l.productId!) }))
  const src = inv ?? d!
  return (
    <InvoiceDocument
      title="PURCHASE INVOICE (GRN)"
      issuer={{ name: inv?.supplierName ?? sup?.name ?? 'Supplier' }}
      party={{ code: settings?.supplierCustomerCode, name: settings?.name, address: settings?.address, phone: settings?.phone }}
      partyLabel="Customer"
      meta={[['Invoice No', src.invoiceNo], ['Invoice Date', src.date], ['Order No', src.orderNo], ['Sales Person', src.salesPerson], ['Pay. Method', src.payMethod]]}
      lines={lines}
      billDiscPct={src.billDiscPct}
      paidAmount={paid}
      footer={src.notes}
    />
  )
}

export function PurchaseEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const existing = useQuery({ queryKey: ['purchases', id], queryFn: () => api.get<PurchaseInvoice>(`/purchases/${id}`), enabled: !!id })
  const { data: suppliers = [] } = useSupplierOptions()
  const save = useApiMutation(
    ({ body }: { body: unknown }) => (id ? api.put<{ id: number; invoiceNo: string }>(`/purchases/${id}`, body) : api.post<{ id: number; invoiceNo: string }>('/purchases', body)),
    { success: (r) => `Purchase ${r.invoiceNo} saved — stock updated`, onSuccess: (r) => nav(`/purchases/${r.id}`, { replace: true }) },
  )
  if (id && existing.isLoading) return <Spinner />
  if (id && existing.error) return <ErrorBox error={existing.error} />
  const inv = existing.data
  const initial = inv ? toDraft(inv) : { ...emptyDraft('purchase'), partyId: suppliers.length === 1 ? suppliers[0].id : null }
  return (
    <div>
      <PageHeader title={inv ? `Edit ${inv.invoiceNo}` : 'Enter supplier invoice'} subtitle="Copy the lines from the supplier's paper invoice — free items go in the Free column" back={{ to: inv ? `/purchases/${inv.id}` : '/purchases', label: inv ? inv.invoiceNo : 'Purchases' }} />
      <InvoiceEditor
        key={`${inv?.id ?? 'new'}-${suppliers.length}`}
        mode="purchase"
        initial={initial}
        submitting={save.isPending}
        onCancel={() => nav(-1)}
        invoiceNoPreview={inv?.invoiceNo ?? 'GRN draft'}
        onSubmit={(d, paid) =>
          save.mutateAsync({
            body: {
              supplierId: d.partyId, invoiceNo: d.invoiceNo, orderNo: d.orderNo, salesPerson: d.salesPerson, date: d.date, payMethod: d.payMethod,
              billDiscPct: d.billDiscPct, paidOnInvoice: paid, notes: d.notes,
              lines: d.lines.map(({ productId, qty, freeQty, unitPrice, discPct }) => ({ productId, qty, freeQty, unitPrice, discPct })),
            },
          })
        }
        renderPreview={(d, paid) => <PurchaseDoc d={d} paid={paid} />}
      />
    </div>
  )
}

export function PurchaseView() {
  const { id } = useParams()
  const nav = useNavigate()
  const confirm = useConfirm()
  const q = useQuery({ queryKey: ['purchases', id], queryFn: () => api.get<PurchaseInvoice>(`/purchases/${id}`) })
  const [preview, setPreview] = useState(false)
  const [paying, setPaying] = useState(false)
  const del = useApiMutation(() => api.del(`/purchases/${id}`), { success: 'Purchase deleted — stock reduced', onSuccess: () => nav('/purchases', { replace: true }) })
  const inv = q.data
  const doc = useMemo(() => inv && <PurchaseDoc inv={inv} paid={inv.paid} />, [inv])
  if (q.isLoading) return <Spinner />
  if (q.error || !inv) return <ErrorBox error={q.error ?? 'Not found'} />
  return (
    <div>
      <PageHeader
        title={inv.invoiceNo}
        back={{ to: '/purchases', label: 'Purchases' }}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Link to={`/suppliers/${inv.supplierId}`} className="hover:underline">{inv.supplierName}</Link> · {inv.date} <StatusBadge status={inv.status} overdue={inv.overdue} /></span>}
        actions={
          <>
            <button
              className="btn-danger"
              onClick={async () =>
                (await confirm({ title: `Delete ${inv.invoiceNo}?`, message: 'All items on this invoice are removed from stock. Not allowed if they were already sold.', confirmText: 'Delete purchase', tone: 'danger' })) && del.mutate(undefined)
              }
            >
              <Trash2 size={15} /> Delete
            </button>
            <Link to={`/purchases/${inv.id}/edit`} className="btn-secondary"><Pencil size={15} /> Edit</Link>
            {inv.due > 0 && <button className="btn-secondary" onClick={() => setPaying(true)}><Wallet size={15} /> Pay</button>}
            <button className="btn-secondary hidden sm:inline-flex" onClick={() => window.print()}><Printer size={15} /> Quick print</button>
            <button className="btn-primary" onClick={() => setPreview(true)}><Eye size={15} /> Print preview</button>
          </>
        }
      />
      <div className="no-print mb-4 grid grid-cols-3 gap-3">
        <Stat label="Net total" value={`Rs ${rs(inv.netTotal)}`} />
        <Stat label="Paid" value={`Rs ${rs(inv.paid)}`} tone="good" />
        <Stat label="Due" value={`Rs ${rs(inv.due)}`} tone={inv.due > 0 ? 'warn' : 'default'} />
      </div>
      {doc}
      <PrintPreview open={preview} onClose={() => setPreview(false)} title={inv.invoiceNo}>{doc}</PrintPreview>
      {paying && <PaymentModal partyType="supplier" partyId={inv.supplierId} defaultAmount={inv.due} reference={inv.invoiceNo} onClose={() => setPaying(false)} />}
    </div>
  )
}
