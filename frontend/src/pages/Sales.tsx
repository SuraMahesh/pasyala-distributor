import { useQuery } from '@tanstack/react-query'
import { Eye, FileSpreadsheet, Paperclip, Pencil, Plus, Printer, ScanLine, Trash2, Undo2, Wallet, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PAY_METHODS, qtyFmt, rs, type SalesInvoice } from '@pjd/shared'
import { BreakdownModal, Td } from '../components/BreakdownModal'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column, type Selection } from '../components/DataTable'
import InvoiceDocument from '../components/InvoiceDocument'
import InvoiceImages from '../components/InvoiceImages'
import InvoiceEditor, { blankLine, emptyDraft, payMethodLabel, type Draft } from '../components/InvoiceEditor'
import { attachScanPhoto, ScanReview, ScanUpload, scanToDraft, type ScanState } from '../components/InvoiceScan'
import PrintPreview from '../components/PrintPreview'
import { Badge, ErrorBox, Filters, PageHeader, SearchBox, Spinner, Stat, StatusBadge } from '../components/ui'
import { api, fetchAll } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { quickPrint } from '../lib/print'
import { useApiMutation, useCustomerOptions, useCustomerTypes, useListState, usePaged, useProductOptions, useSettings } from '../lib/hooks'
import { PaymentModal } from './Payments'

interface SaleRow {
  id: number
  invoiceNo: string
  date: string
  payMethod: string
  chequeNo: string
  chequeDate: string | null
  netTotal: number
  costTotal: number
  gross: number
  billDiscPct: number
  /** gross − net: everything taken off the list price for this customer */
  discountGiven: number
  /** the supplier's item discount (22%) on the same goods */
  itemDiscount: number
  /** discountGiven − itemDiscount: 8% of gross for a 30% customer, 13% for 35% */
  discountMargin: number
  /** the supplier's bill discount rate (8%) and its amount on these goods after the item discount */
  supplierBillDiscPct: number
  supplierBillDiscount: number
  customerId: number
  partyName: string
  area: string
  typeName: string
  paid: number
  due: number
  status: SalesInvoice['status']
  dueDate: string
  overdue: boolean
  imageCount: number
}

export function SalesList() {
  const [s, set] = useListState({ from: '', to: '', status: '', payMethod: '', typeId: '', customerId: '', images: '', sort: 'date', dir: 'desc' as const })
  const { data: types = [] } = useCustomerTypes()
  const { data: customers = [] } = useCustomerOptions()
  const q = usePaged<SaleRow, { count: number; netTotal: number; due: number; profit: number; gross: number; discountGiven: number; itemDiscount: number; discountMargin: number; supplierBillDiscPct: number; supplierBillDiscount: number }>('sales', '/sales', s)
  // the invoice-by-invoice table behind the Net sales / Discount margin tiles (every row of the current filter)
  const [breakdown, setBreakdown] = useState<{ kind: 'net' | 'margin'; rows: SaleRow[]; loading: boolean } | null>(null)
  const openBreakdown = async (kind: 'net' | 'margin') => {
    setBreakdown({ kind, rows: [], loading: true })
    try {
      setBreakdown({ kind, rows: await fetchAll<SaleRow>('/sales', { ...s, page: undefined, pageSize: undefined }), loading: false })
    } catch {
      setBreakdown(null)
    }
  }
  const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '')

  const columns: Column<SaleRow>[] = [
    { key: 'no', header: 'Invoice', sortKey: 'invoiceNo', render: (r) => <Link to={`/sales/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.invoiceNo}</Link> },
    { key: 'photo', header: <Paperclip size={14} aria-label="Photos" />, align: 'center', mobile: false, render: (r) => (r.imageCount ? <span className="inline-flex items-center gap-0.5 text-xs text-brand-700" title={`${r.imageCount} photo(s) of the paper invoice`}><Paperclip size={13} />{r.imageCount > 1 ? r.imageCount : ''}</span> : <span className="text-xs text-stone-300" title="No photo yet">—</span>) },
    { key: 'date', header: 'Date', sortKey: 'date', render: (r) => <span className="text-stone-500">{r.date}</span> },
    { key: 'party', header: 'Customer', sortKey: 'party', render: (r) => <span>{r.partyName}<span className="ml-1.5 text-xs text-stone-400">{r.typeName}</span></span> },
    { key: 'area', header: 'Area', hideBelow: 'xl', render: (r) => <span className="text-stone-500">{r.area}</span>, mobile: false },
    { key: 'method', header: 'Method', hideBelow: 'lg', render: (r) => (r.payMethod === 'Cheque' && r.due > 0 ? <span className="text-amber-700" title={`Cheque ${r.chequeNo} not cleared yet`}>Cheque{r.chequeDate ? <span className="block text-xs">due {r.chequeDate}</span> : null}</span> : <span className="text-stone-500">{r.payMethod}</span>) },
    { key: 'net', header: 'Net total', sortKey: 'netTotal', align: 'right', render: (r) => <span className="font-medium">{rs(r.netTotal)}</span> },
    { key: 'due', header: 'Due', sortKey: 'due', align: 'right', render: (r) => (r.due > 0 ? rs(r.due) : <span className="text-stone-300">—</span>) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.overdue} /> },
  ]

  const exportRows = (all: SaleRow[], fileBase: string) =>
    downloadExcel(fileBase, [{
      name: 'Sales invoices',
      columns: [
        { header: 'Invoice' }, { header: 'Date', type: 'date' }, { header: 'Customer' }, { header: 'Customer type' }, { header: 'Area' },
        { header: 'Method' }, { header: 'Gross', type: 'money' }, { header: 'Disc %' }, { header: 'Discount given', type: 'money' }, { header: 'Item discount (supplier)', type: 'money' }, { header: 'Discount margin', type: 'money' },
        { header: 'Net total', type: 'money' }, { header: 'Cost', type: 'money' }, { header: 'Profit', type: 'money' },
        { header: 'Paid', type: 'money' }, { header: 'Due', type: 'money' }, { header: 'Status' }, { header: 'Due date', type: 'date' }, { header: 'Cheque no' }, { header: 'Cheque date', type: 'date' },
      ],
      rows: all.map((r) => [r.invoiceNo, r.date, r.partyName, r.typeName, r.area, r.payMethod, r.gross, r.billDiscPct, r.discountGiven, r.itemDiscount, r.discountMargin, r.netTotal, r.costTotal, r.netTotal - r.costTotal, r.paid, r.due, r.overdue ? 'Overdue' : r.status === 'paid' ? 'Paid' : r.status === 'partial' ? 'Part paid' : 'Unpaid', r.dueDate, r.chequeNo, r.chequeDate]),
      totals: [6, 8, 9, 10, 11, 12, 13, 14, 15],
    }])
  const exportExcel = async () => exportRows(await fetchAll<SaleRow>('/sales', { ...s, page: undefined, pageSize: undefined }), 'sales')

  // selected rows (the first column's checkboxes) — kept across pages until cleared
  const [picked, setPicked] = useState<Map<number, SaleRow>>(() => new Map())
  const selection: Selection<SaleRow> = {
    isSelected: (r) => picked.has(r.id),
    onToggle: (r, on) => setPicked((m) => { const next = new Map(m); if (on) next.set(r.id, r); else next.delete(r.id); return next }),
    onToggleAll: (rows, on) => setPicked((m) => { const next = new Map(m); for (const r of rows) if (on) next.set(r.id, r); else next.delete(r.id); return next }),
  }
  const sel = useMemo(() => {
    const l = [...picked.values()]
    const add = (f: (r: SaleRow) => number) => l.reduce((a, r) => a + f(r), 0)
    return { n: l.length, gross: add((r) => r.gross), net: add((r) => r.netTotal), profit: add((r) => r.netTotal - r.costTotal), paid: add((r) => r.paid), due: add((r) => r.due) }
  }, [picked])

  const sum = q.data?.summary
  // totals of the rows behind the Net sales table: list price → after the supplier's 22% → after the customer's discount
  const bt = useMemo(() => {
    if (!breakdown) return null
    const add = (f: (r: SaleRow) => number) => breakdown.rows.reduce((a, r) => a + f(r), 0)
    const g = add((r) => r.gross)
    const item = add((r) => r.itemDiscount)
    const bill = add((r) => r.supplierBillDiscount)
    const billPct = breakdown.rows[0]?.supplierBillDiscPct ?? q.data?.summary?.supplierBillDiscPct ?? 0
    const net = add((r) => r.netTotal)
    // after22: the goods at the supplier's item price; after: at the supplier's net price (22% + 8%, the paid-unit cost at list)
    return { n: breakdown.rows.length, g, item, after22: g - item, bill, billPct, after: g - item - bill, given: add((r) => r.discountGiven), net, paid: add((r) => r.paid), due: add((r) => r.due) }
  }, [breakdown, q.data?.summary?.supplierBillDiscPct])
  return (
    <div>
      <PageHeader
        title="Sales invoices"
        subtitle="Sales to shops, medical centers and walk-in customers"
        actions={
          <>
            <Link to="/sales/returns" className="btn-secondary"><Undo2 size={16} /> Returns</Link>
            <Link to="/sales/new" className="btn-secondary"><ScanLine size={16} /> Scan invoice image</Link>
            <Link to="/sales/new" className="btn-primary"><Plus size={16} /> New sale</Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Invoices" value={sum ? qtyFmt(sum.count) : '…'} />
        <Stat label="Net sales" value={sum ? `Rs ${rs(sum.netTotal)}` : '…'} hint={sum?.gross ? `gross Rs ${rs(sum.gross)} less Rs ${rs(sum.discountGiven)} discounts · tap for the table` : 'what customers were billed after discounts · tap for the table'} onClick={() => openBreakdown('net')} />
        <Stat label="Discount margin" value={sum ? `Rs ${rs(sum.discountMargin)}` : '…'} hint={sum?.gross ? `${pct(sum.discountMargin, sum.gross)} of gross · customer discount less the 22% item discount · tap for the table` : 'customer discount less the 22% item discount'} onClick={() => openBreakdown('margin')} />
        <Stat label="Gross profit" value={sum ? `Rs ${rs(sum.profit)}` : '…'} tone="good" />
        <Stat label="Still to collect" value={sum ? `Rs ${rs(sum.due)}` : '…'} tone={sum?.due ? 'warn' : 'default'} />
      </div>
      {breakdown?.kind === 'net' && bt && (
        <BreakdownModal<SaleRow>
          title="Net sales by invoice"
          subtitle={<>
            {!breakdown.loading && bt.n > 0 && (
              <dl className="mb-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-stone-50 p-3 text-stone-700 sm:grid-cols-[1fr_auto_auto]">
                <dt>Total sales at list price (before any discount) · {bt.n} invoices</dt><dd className="text-right font-medium tabular-nums">Rs {rs(bt.g)}</dd><dd className="hidden sm:block" />
                <dt className="text-stone-500">less the supplier's item discount 22%</dt><dd className="text-right tabular-nums text-stone-500">− Rs {rs(bt.item)}</dd><dd className="col-span-2 text-right text-xs text-stone-500 sm:col-span-1 sm:text-sm">after 22% · Rs {rs(bt.after22)}</dd>
                <dt className="text-stone-500">less the supplier's bill discount {bt.billPct}% (on the remainder)</dt><dd className="text-right tabular-nums text-stone-500">− Rs {rs(bt.bill)}</dd><dd className="col-span-2 text-right text-xs text-stone-500 sm:col-span-1 sm:text-sm">after 22% + {bt.billPct}% · Rs {rs(bt.after)} ({pct(bt.after, bt.g)} of list)</dd>
                <dt className="text-stone-500">less the discount given to customers ({pct(bt.given, bt.g)} of list)</dt><dd className="text-right tabular-nums text-stone-500">− Rs {rs(bt.given)}</dd><dd className="col-span-2 text-right text-xs text-stone-500 sm:col-span-1 sm:text-sm">margin over 22% · Rs {rs(bt.given - bt.item)}</dd>
                <dt className="font-semibold text-stone-900">Net sales</dt><dd className="text-right font-semibold tabular-nums text-brand-700">Rs {rs(bt.net)}</dd><dd className="col-span-2 text-right text-xs text-stone-500 sm:col-span-1 sm:text-sm">vs after 22% + {bt.billPct}% · <span className={bt.net - bt.after < 0 ? 'text-red-600' : 'text-brand-700'}>{bt.net - bt.after < 0 ? '−' : '+'} Rs {rs(Math.abs(bt.net - bt.after))}</span> · paid Rs {rs(bt.paid)} · due Rs {rs(bt.due)}</dd>
              </dl>
            )}
            <b>Gross</b> is the total at list price before any discount. <b>Item disc 22%</b> is what the supplier takes off those goods on each line, and <b>bill disc {bt.billPct}%</b> is taken off that remainder, so <b>after 22% + {bt.billPct}%</b> is the goods at the supplier's net price, the paid unit cost. Free items are not in these figures: they are tracked in stock only, on both sides.
            <b> Discount given</b> is the customer's 30% / 35% bill discount (or line discounts on hand-typed bills); <b>net sales</b> is what the customers were billed.
            Payments do not change it — <b>Paid</b> and <b>Due</b> show how much has been collected. Returns are credited against the invoice but not deducted here; Reports shows sales net of returns.
          </>}
          rows={breakdown.rows}
          loading={breakdown.loading}
          rowKey={(r) => r.id}
          initialSort={{ key: 'date', dir: 'desc' }}
          onClose={() => setBreakdown(null)}
          columns={[
            { key: 'no', header: 'Invoice', sortKey: 'invoiceNo', sortValue: (r) => r.invoiceNo, render: (r) => <Link to={`/sales/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.invoiceNo}</Link> },
            { key: 'date', header: 'Date', sortKey: 'date', sortValue: (r) => r.date, render: (r) => <span className="text-stone-500">{r.date}</span> },
            { key: 'cust', header: 'Customer', sortKey: 'party', sortValue: (r) => r.partyName, render: (r) => <span>{r.partyName}<span className="ml-1.5 text-xs text-stone-400">{r.typeName}</span></span> },
            { key: 'gross', header: 'Gross (list)', align: 'right', sortKey: 'gross', sortValue: (r) => r.gross, render: (r) => <span className="font-medium">{rs(r.gross)}</span> },
            { key: 'item', header: 'Item disc 22%', align: 'right', hideBelow: 'xl', render: (r) => <span className="text-stone-500">{rs(r.itemDiscount)}</span> },
            { key: 'bill', header: `Bill disc ${bt.billPct}%`, align: 'right', hideBelow: 'xl', render: (r) => <span className="text-stone-500">{rs(r.supplierBillDiscount)}</span> },
            { key: 'after', header: `After 22% + ${bt.billPct}%`, align: 'right', hideBelow: 'lg', sortKey: 'after', sortValue: (r) => r.gross - r.itemDiscount - r.supplierBillDiscount, render: (r) => rs(r.gross - r.itemDiscount - r.supplierBillDiscount) },
            { key: 'pct', header: 'Disc %', align: 'right', hideBelow: 'xl', render: (r) => pct(r.discountGiven, r.gross) },
            { key: 'given', header: 'Discount given', align: 'right', sortKey: 'given', sortValue: (r) => r.discountGiven, render: (r) => <span className="text-stone-500">{rs(r.discountGiven)}</span> },
            { key: 'net', header: 'Net sales', align: 'right', sortKey: 'net', sortValue: (r) => r.netTotal, render: (r) => <span className="font-medium text-brand-700">{rs(r.netTotal)}</span> },
            { key: 'paid', header: 'Paid', align: 'right', hideBelow: 'xl', sortKey: 'paid', sortValue: (r) => r.paid, render: (r) => rs(r.paid) },
            { key: 'due', header: 'Due', align: 'right', sortKey: 'due', sortValue: (r) => r.due, render: (r) => (r.due > 0 ? <span className={r.overdue ? 'text-red-600' : 'text-amber-600'}>{rs(r.due)}</span> : <span className="text-stone-300">—</span>) },
          ]}
          footer={bt.n ? <tr><td colSpan={3}>Total · {bt.n} invoices</td><Td>{rs(bt.g)}</Td><Td className="hidden xl:table-cell">{rs(bt.item)}</Td><Td className="hidden xl:table-cell">{rs(bt.bill)}</Td><Td className="hidden lg:table-cell">{rs(bt.after)}</Td><Td className="hidden xl:table-cell">{pct(bt.given, bt.g)}</Td><Td>{rs(bt.given)}</Td><Td className="text-brand-700">{rs(bt.net)}</Td><Td className="hidden xl:table-cell">{rs(bt.paid)}</Td><Td>{rs(bt.due)}</Td></tr> : null}
          onExcel={() => downloadExcel('sales-net', [{
            name: 'Net sales by invoice',
            columns: [
              { header: 'Invoice' }, { header: 'Date', type: 'date' }, { header: 'Customer' }, { header: 'Customer type' }, { header: 'Method' },
              { header: 'Gross (list)', type: 'money' }, { header: 'Item discount 22%', type: 'money' }, { header: `Bill discount ${bt.billPct}%`, type: 'money' }, { header: `After 22% + ${bt.billPct}%`, type: 'money' },
              { header: 'Disc %', type: 'pct' }, { header: 'Discount given', type: 'money' }, { header: 'Net sales', type: 'money' }, { header: 'Paid', type: 'money' }, { header: 'Due', type: 'money' },
            ],
            rows: breakdown.rows.map((r) => [r.invoiceNo, r.date, r.partyName, r.typeName, payMethodLabel(r.payMethod), r.gross, r.itemDiscount, r.supplierBillDiscount, r.gross - r.itemDiscount - r.supplierBillDiscount, r.gross ? (r.discountGiven / r.gross) * 100 : null, r.discountGiven, r.netTotal, r.paid, r.due]),
            totals: [5, 6, 7, 8, 10, 11, 12, 13],
          }])}
          totals={[
            { label: 'Invoices', value: bt.n },
            { label: 'Gross (list, before discounts)', value: `Rs ${rs(bt.g)}` },
            { label: 'Item discount 22%', value: `− Rs ${rs(bt.item)}` },
            { label: `Bill discount ${bt.billPct}%`, value: `− Rs ${rs(bt.bill)}` },
            { label: `After 22% + ${bt.billPct}%`, value: `Rs ${rs(bt.after)}` },
            { label: `Discount given (${pct(bt.given, bt.g)})`, value: `− Rs ${rs(bt.given)}` },
            { label: 'Net sales', value: <span className="font-semibold text-brand-700">Rs {rs(bt.net)}</span> },
            { label: 'Paid', value: `Rs ${rs(bt.paid)}` },
            { label: 'Due', value: `Rs ${rs(bt.due)}` },
          ]}
        />
      )}
      {breakdown?.kind === 'margin' && (
        <BreakdownModal<SaleRow>
          title="Discount margin by invoice"
          subtitle="Discount given = gross − net (the 30% / 35% the customer gets). Item discount = the supplier's 22% on the same goods. Discount margin = the difference: 8% of gross for a 30% customer, 13% for 35%."
          rows={breakdown.rows}
          loading={breakdown.loading}
          rowKey={(r) => r.id}
          initialSort={{ key: 'date', dir: 'desc' }}
          onClose={() => setBreakdown(null)}
          columns={[
            { key: 'no', header: 'Invoice', sortKey: 'invoiceNo', sortValue: (r) => r.invoiceNo, render: (r) => <Link to={`/sales/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.invoiceNo}</Link> },
            { key: 'date', header: 'Date', sortKey: 'date', sortValue: (r) => r.date, render: (r) => <span className="text-stone-500">{r.date}</span> },
            { key: 'cust', header: 'Customer', sortKey: 'party', sortValue: (r) => r.partyName, render: (r) => r.partyName },
            { key: 'pct', header: 'Disc %', align: 'right', render: (r) => pct(r.discountGiven, r.gross) },
            { key: 'gross', header: 'Gross', align: 'right', sortKey: 'gross', sortValue: (r) => r.gross, render: (r) => rs(r.gross) },
            { key: 'given', header: 'Discount given', align: 'right', sortKey: 'given', sortValue: (r) => r.discountGiven, render: (r) => rs(r.discountGiven) },
            { key: 'item', header: 'Item disc 22%', align: 'right', hideBelow: 'lg', render: (r) => <span className="text-stone-500">{rs(r.itemDiscount)}</span> },
            { key: 'mpct', header: 'Margin %', align: 'right', hideBelow: 'lg', render: (r) => pct(r.discountMargin, r.gross) },
            { key: 'margin', header: 'Discount margin', align: 'right', sortKey: 'margin', sortValue: (r) => r.discountMargin, render: (r) => <span className={`font-medium ${r.discountMargin < 0 ? 'text-red-600' : 'text-brand-700'}`}>{rs(r.discountMargin)}</span> },
            { key: 'net', header: 'Net', align: 'right', hideBelow: 'xl', render: (r) => rs(r.netTotal) },
          ]}
          footer={(() => {
            const l = breakdown.rows
            const g = l.reduce((a, r) => a + r.gross, 0)
            const given = l.reduce((a, r) => a + r.discountGiven, 0)
            const item = l.reduce((a, r) => a + r.itemDiscount, 0)
            const m = l.reduce((a, r) => a + r.discountMargin, 0)
            return l.length ? <tr><td colSpan={3}>Total · {l.length} invoices</td><Td>{pct(given, g)}</Td><Td>{rs(g)}</Td><Td>{rs(given)}</Td><Td className="hidden lg:table-cell">{rs(item)}</Td><Td className="hidden lg:table-cell">{pct(m, g)}</Td><Td>{rs(m)}</Td><Td className="hidden xl:table-cell">{rs(l.reduce((a, r) => a + r.netTotal, 0))}</Td></tr> : null
          })()}
          onExcel={() => downloadExcel('sales-discount-margin', [{
            name: 'Discount margin by invoice',
            columns: [
              { header: 'Invoice' }, { header: 'Date', type: 'date' }, { header: 'Customer' }, { header: 'Disc %', type: 'pct' }, { header: 'Gross', type: 'money' },
              { header: 'Discount given', type: 'money' }, { header: 'Item discount 22%', type: 'money' }, { header: 'Margin %', type: 'pct' }, { header: 'Discount margin', type: 'money' }, { header: 'Net', type: 'money' },
            ],
            rows: breakdown.rows.map((r) => [r.invoiceNo, r.date, r.partyName, r.gross ? (r.discountGiven / r.gross) * 100 : null, r.gross, r.discountGiven, r.itemDiscount, r.gross ? (r.discountMargin / r.gross) * 100 : null, r.discountMargin, r.netTotal]),
            totals: [4, 5, 6, 8, 9],
          }])}
          totals={(() => {
            const l = breakdown.rows
            const g = l.reduce((a, r) => a + r.gross, 0)
            const given = l.reduce((a, r) => a + r.discountGiven, 0)
            const item = l.reduce((a, r) => a + r.itemDiscount, 0)
            const m = l.reduce((a, r) => a + r.discountMargin, 0)
            return [
              { label: 'Invoices', value: l.length },
              { label: 'Gross', value: `Rs ${rs(g)}` },
              { label: `Discount given (${pct(given, g)})`, value: `Rs ${rs(given)}` },
              { label: 'Item discount 22%', value: `Rs ${rs(item)}` },
              { label: `Discount margin (${pct(m, g)})`, value: <span className={`font-semibold ${m < 0 ? 'text-red-600' : 'text-brand-700'}`}>Rs {rs(m)}</span> },
              { label: 'Net', value: `Rs ${rs(l.reduce((a, r) => a + r.netTotal, 0))}` },
            ]
          })()}
        />
      )}
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Invoice no, customer, area…" />
        <select className="input" value={s.images} onChange={(e) => set({ images: e.target.value })} aria-label="Photos">
          <option value="">Photos: all</option>
          <option value="has">With photo</option>
          <option value="none">Missing photo</option>
        </select>
        <select className="input" value={s.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="due">Unpaid / part paid</option>
          <option value="overdue">Overdue</option>
          <option value="cheque">Cheque not cleared</option>
          <option value="paid">Paid</option>
        </select>
        <select className="input" value={s.payMethod} onChange={(e) => set({ payMethod: e.target.value })} aria-label="Payment method">
          <option value="">All payment methods</option>
          {PAY_METHODS.map((m) => <option key={m} value={m}>{m === 'Credit' ? 'Credit (on account)' : m}</option>)}
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
        <button className="btn-secondary" onClick={exportExcel} title="Download the sales shown (every page of the current filter) as an Excel file"><FileSpreadsheet size={16} /> Excel</button>
      </Filters>
      {sel.n > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-stone-700">
          <span className="font-semibold text-stone-900">{sel.n} selected</span>
          <span>net <b className="tabular-nums">Rs {rs(sel.net)}</b></span>
          <span className="hidden sm:inline">gross <span className="tabular-nums">Rs {rs(sel.gross)}</span></span>
          <span>paid <span className="tabular-nums">Rs {rs(sel.paid)}</span></span>
          <span>due <b className={`tabular-nums ${sel.due > 0 ? 'text-amber-700' : ''}`}>Rs {rs(sel.due)}</b></span>
          <span className="hidden sm:inline">gross profit <span className="tabular-nums">Rs {rs(sel.profit)}</span></span>
          <div className="ml-auto flex gap-2">
            <button className="btn-secondary min-h-9" onClick={() => exportRows([...picked.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id), 'sales-selected')}><FileSpreadsheet size={15} /> Excel (selected)</button>
            <button className="btn-ghost min-h-9" onClick={() => setPicked(new Map())}><X size={15} /> Unselect all</button>
          </div>
        </div>
      )}
      <DataTable
        rows={q.data?.items ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        loading={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        selection={selection}
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
    paidTouched: Math.abs(inv.paidOnInvoice - inv.netTotal) > 0.004 && !(inv.payMethod === 'Cheque' && inv.paidOnInvoice === 0), // fully paid cash invoices keep following the total
    notes: inv.notes,
    chequeNo: inv.chequeNo,
    chequeDate: inv.chequeDate ?? '',
    chequePaid: inv.payMethod === 'Cheque' && inv.paidOnInvoice + 0.004 >= inv.netTotal,
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
    {
      success: (r) => `Invoice ${r.invoiceNo} saved`,
      onSuccess: async (r) => {
        if (scan?.file && !id) await attachScanPhoto('sale', r.id, r.invoiceNo, scan)
        nav(`/sales/${r.id}`, { replace: true })
      },
    },
  )

  if (id && existing.isLoading) return <Spinner />
  if (id && existing.error) return <div><PageHeader title="Edit sales invoice" back={{ to: '/sales', label: 'Sales' }} /><ErrorBox error={existing.error} /></div>
  const inv = existing.data
  const invoiceNo = inv?.invoiceNo ?? `${settings?.invoicePrefix ?? ''}${String(settings?.nextInvoiceNo ?? 1).padStart(6, '0')}`
  const onScanned = (s: ScanState) => { setScan(s); setScanNo((n) => n + 1) }
  const ownQty = new Map<number, number>()
  inv?.lines.forEach((l) => ownQty.set(l.productId, (ownQty.get(l.productId) ?? 0) + l.qty + l.freeQty))

  return (
    <div>
      <PageHeader title={inv ? `Edit ${inv.invoiceNo}` : 'New sales invoice'} subtitle={inv ? `${inv.customerName} · ${inv.date}` : `${invoiceNo ? `Will be ${invoiceNo} · ` : ''}Prices fill in from the customer type, product price rules and promotions`} back={{ to: inv ? `/sales/${inv.id}` : '/sales', label: inv ? inv.invoiceNo : 'Sales' }} />
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
            body: { customerId: d.partyId, date: d.date, payMethod: d.payMethod, billDiscPct: d.billDiscPct, paidOnInvoice: paid, notes: d.notes, chequeNo: d.chequeNo, chequeDate: d.payMethod === 'Cheque' && d.chequeDate ? d.chequeDate : null, lines: d.lines.map(({ productId, qty, freeQty, unitPrice, discPct }) => ({ productId, qty, freeQty, unitPrice, discPct })) },
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
      meta={[['Invoice No', invoiceNo], ['Invoice Date', d.date], ['Pay. Method', payMethodLabel(d.payMethod, d.chequeNo, d.chequeDate)], ['Notes', d.notes]]}
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
  const cleared = useApiMutation(() => api.post(`/sales/${id}/cheque-cleared`, {}), { success: 'Cheque cleared — invoice marked paid' })
  const markCleared = async () => {
    const inv = q.data!
    if (await confirm({ title: 'Cheque cleared?', message: `${inv.invoiceNo} will be marked paid in full (Rs ${rs(inv.netTotal)}) by cheque${inv.chequeNo ? ` ${inv.chequeNo}` : ''}.`, confirmText: 'Mark paid' })) cleared.mutate(undefined)
  }
  const returned = q.data?.returns.reduce((s, r) => s + r.netTotal, 0) ?? 0

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
          meta={[['Invoice No', inv.invoiceNo], ['Invoice Date', inv.date], ['Pay. Method', payMethodLabel(inv.payMethod, inv.chequeNo, inv.chequeDate)], ['Due Date', inv.due > 0.004 ? inv.dueDate : ''], ['Notes', inv.notes]]}
          lines={inv.lines}
          billDiscPct={inv.billDiscPct}
          paidAmount={inv.paid}
          footer={settings?.footerNote}
        />
      ),
    [inv, settings, cust],
  )
  if (q.isLoading) return <Spinner />
  if (q.error || !inv) return <div><PageHeader title="Sales invoice" back={{ to: '/sales', label: 'Sales' }} /><ErrorBox error={q.error ?? 'Not found'} onRetry={() => q.refetch()} /></div>

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
            <Link to={`/sales/returns/new?invoice=${inv.id}`} className="btn-secondary" title="Record goods this customer sent back from this invoice"><Undo2 size={15} /> Return items</Link>
            {inv.due > 0 && inv.payMethod === 'Cheque' && <button className="btn-secondary" onClick={markCleared} disabled={cleared.isPending}><Wallet size={15} /> Cheque cleared</button>}
            {inv.due > 0 && inv.payMethod !== 'Cheque' && <button className="btn-secondary" onClick={() => setPaying(true)}><Wallet size={15} /> Receive</button>}
            <button className="btn-secondary hidden sm:inline-flex" onClick={() => quickPrint(`${inv.invoiceNo}`)}><Printer size={15} /> Quick print</button>
            <button className="btn-primary" onClick={() => setPreview(true)}><Eye size={15} /> Print preview</button>
          </>
        }
      />
      <div className="no-print mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net total" value={`Rs ${rs(inv.netTotal)}`} />
        <Stat label="Paid" value={`Rs ${rs(inv.paid)}`} hint={[inv.paidOnInvoice ? `Rs ${rs(inv.paidOnInvoice)} on invoice` : '', inv.credited ? `Rs ${rs(inv.credited)} by returns` : ''].filter(Boolean).join(' · ') || undefined} tone="good" />
        <Stat label="Due" value={`Rs ${rs(inv.due)}`} hint={inv.due > 0 ? `by ${inv.dueDate}` : undefined} tone={inv.overdue ? 'bad' : inv.due > 0 ? 'warn' : 'default'} />
        <Stat label="Gross profit" value={`Rs ${rs(profit)}`} hint={inv.netTotal ? `${((profit / inv.netTotal) * 100).toFixed(1)}% · cost Rs ${rs(inv.costTotal)}` : undefined} tone={profit < 0 ? 'bad' : 'good'} />
      </div>
      {inv.customerTypeName && <p className="no-print mb-3 text-sm text-stone-500">Customer type: <Badge tone="blue">{inv.customerTypeName}</Badge></p>}
      {inv.payMethod === 'Cheque' && (
        <p className={`no-print mb-3 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${inv.due > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-brand-200 bg-brand-50 text-brand-800'}`}>
          <Wallet size={16} />
          {inv.due > 0 ? (
            <>Cheque{inv.chequeNo ? ` ${inv.chequeNo}` : ''}{inv.chequeDate ? ` dated ${inv.chequeDate}` : ''} is not paid yet — the invoice falls due on {inv.chequeDate ?? inv.dueDate}.
              <button className="font-medium underline" onClick={markCleared}>Mark the cheque cleared</button>
              {!inv.chequeDate && <Link className="font-medium underline" to={`/sales/${inv.id}/edit`}>Add the cheque date</Link>}</>
          ) : (
            <>Paid by cheque{inv.chequeNo ? ` ${inv.chequeNo}` : ''}{inv.chequeDate ? ` dated ${inv.chequeDate}` : ''}.</>
          )}
        </p>
      )}
      {inv.returns.length > 0 && (
        <p className="no-print mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Undo2 size={16} /> Goods worth Rs {rs(returned)} came back on
          {inv.returns.map((r) => <Link key={r.id} to={`/sales/returns/${r.id}`} className="font-medium underline">{r.returnNo}</Link>)}
          <span className="text-xs">— this invoice cannot be deleted while those returns exist.</span>
        </p>
      )}
      <InvoiceImages kind="sale" invoiceId={inv.id} invoiceNo={inv.invoiceNo} partyName={inv.customerName} />
      {doc}
      <PrintPreview open={preview} onClose={() => setPreview(false)} title={inv.invoiceNo}>{doc}</PrintPreview>
      {paying && <PaymentModal partyType="customer" partyId={inv.customerId} defaultAmount={inv.due} reference={inv.invoiceNo} onClose={() => setPaying(false)} />}
    </div>
  )
}
