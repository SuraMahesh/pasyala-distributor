import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addDays, rs, todayLK } from '@pjd/shared'
import { ClientTable } from '../components/DataTable'
import { Badge, Filters, PageHeader, Spinner, Stat, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { downloadExcel, type XSheet } from '../lib/excel'

type Tab = 'product' | 'customer' | 'type' | 'daily' | 'aging'
interface Profit { revenue: number; cost: number; profit: number }
type ByProduct = Profit & { productId: number; code: string; label: string; qty: number; free: number; invoices: number }
type ByCustomer = Profit & { customerId: number; name: string; typeName: string; area: string; invoices: number }
type ByType = Profit & { typeId: number; name: string; customers: number; invoices: number }
type Daily = Profit & { date: string; invoices: number; collected: number }
interface Aging { customerId: number; name: string; typeName: string; phone: string; current: number; d30: number; d60: number; d90: number; d90plus: number; total: number }

const PRESETS: [string, () => [string, string]][] = [
  ['Today', () => [todayLK(), todayLK()]],
  ['This month', () => [todayLK().slice(0, 8) + '01', todayLK()]],
  ['Last 30 days', () => [addDays(todayLK(), -29), todayLK()]],
  ['Last month', () => {
    const first = todayLK().slice(0, 8) + '01'
    const end = addDays(first, -1)
    return [end.slice(0, 8) + '01', end]
  }],
  ['This year', () => [todayLK().slice(0, 4) + '-01-01', todayLK()]],
]

const money = (k: keyof Profit) => ({ align: 'right' as const, sortKey: k, sortValue: (r: Profit) => r[k], render: (r: Profit) => (k === 'profit' ? <span className={r.profit < 0 ? 'text-red-600' : 'text-brand-700'}>{rs(r.profit)}</span> : rs(r[k])) })
const margin = { key: 'margin', header: 'Margin', align: 'right' as const, hideBelow: 'lg' as const, render: (r: Profit) => (r.revenue ? `${((r.profit / r.revenue) * 100).toFixed(1)}%` : '') }

export default function Reports() {
  const [params, setParams] = useSearchParams()
  const [from, setFrom] = useState(params.get('from') ?? todayLK().slice(0, 8) + '01')
  const [to, setTo] = useState(params.get('to') ?? todayLK())
  const tab = (params.get('tab') as Tab) || 'product'
  const setTab = (t: Tab) => setParams({ tab: t, from, to }, { replace: true })

  const summary = useQuery({ queryKey: ['reports', 'summary', from, to], queryFn: () => api.get<Record<string, number>>('/reports/summary', { from, to }) })
  const path = { product: '/reports/by-product', customer: '/reports/by-customer', type: '/reports/by-type', daily: '/reports/daily', aging: '/reports/aging' }[tab]
  const data = useQuery({ queryKey: ['reports', tab, from, to], queryFn: () => api.get<unknown[]>(path, tab === 'aging' ? undefined : { from, to }) })
  const s = summary.data

  const exportExcel = () => {
    const pct = (p: Profit) => (p.revenue ? (p.profit / p.revenue) * 100 : null)
    const money = (h: string) => ({ header: h, type: 'money' as const })
    const int = (h: string) => ({ header: h, type: 'int' as const })
    const list = (data.data ?? []) as never[]
    const sheet: XSheet = {
      product: () => ({
        name: 'By product',
        columns: [{ header: 'Code' }, { header: 'Item' }, int('Qty'), int('Free'), int('Invoices'), money('Sales'), money('Cost'), money('Profit'), { header: 'Margin', type: 'pct' as const }],
        rows: (list as ByProduct[]).map((r) => [r.code, r.label, r.qty, r.free, r.invoices, r.revenue, r.cost, r.profit, pct(r)]),
        totals: [2, 3, 5, 6, 7],
      }),
      customer: () => ({
        name: 'By customer',
        columns: [{ header: 'Customer' }, { header: 'Type' }, { header: 'Area' }, int('Invoices'), money('Sales'), money('Cost'), money('Profit'), { header: 'Margin', type: 'pct' as const }],
        rows: (list as ByCustomer[]).map((r) => [r.name, r.typeName, r.area, r.invoices, r.revenue, r.cost, r.profit, pct(r)]),
        totals: [3, 4, 5, 6],
      }),
      type: () => ({
        name: 'By customer type',
        columns: [{ header: 'Customer type' }, int('Customers'), int('Invoices'), money('Sales'), money('Cost'), money('Profit'), { header: 'Margin', type: 'pct' as const }],
        rows: (list as ByType[]).map((r) => [r.name, r.customers, r.invoices, r.revenue, r.cost, r.profit, pct(r)]),
        totals: [1, 2, 3, 4, 5],
      }),
      daily: () => ({
        name: 'Daily sales',
        columns: [{ header: 'Date', type: 'date' as const }, int('Invoices'), money('Sales'), money('Paid on invoice'), money('Cost'), money('Profit')],
        rows: (list as Daily[]).map((r) => [r.date, r.invoices, r.revenue, r.collected, r.cost, r.profit]),
        totals: [1, 2, 3, 4, 5],
      }),
      aging: () => ({
        name: 'Unpaid aging',
        columns: [{ header: 'Customer' }, { header: 'Type' }, { header: 'Phone' }, money('Not due'), money('1-30 days'), money('31-60 days'), money('61-90 days'), money('Over 90 days'), money('Total')],
        rows: (list as Aging[]).map((r) => [r.name, r.typeName, r.phone, r.current, r.d30, r.d60, r.d90, r.d90plus, r.total]),
        totals: [3, 4, 5, 6, 7, 8],
      }),
    }[tab]()
    const summarySheet: XSheet = {
      name: 'Summary',
      columns: [{ header: `Report ${from} to ${to}`, width: 30 }, { header: 'Value', type: 'money', width: 18 }],
      rows: [
        ['Sales', s?.revenue], ['Invoices', s?.invoices], ['Units sold', s?.unitsSold], ['Free units', s?.freeUnits],
        ['Gross profit', s?.profit], ['Margin %', s?.margin], ['Cash collected', s?.collected], ['Purchases', s?.purchases],
        ['Paid to suppliers', s?.paidOut], ['To collect now', s?.receivable], ['Overdue now', s?.overdue], ['Owe suppliers now', s?.payable], ['Stock value', s?.stockValue],
      ],
    }
    downloadExcel(`report-${tab}-${from}-to-${to}`, [summarySheet, sheet], { dated: false })
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle={`${from} to ${to}`} />
      <Filters>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:w-auto">
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <span className="text-stone-400">to</span>
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(([label, fn]) => (
            <button key={label} className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-50" onClick={() => { const [a, b] = fn(); setFrom(a); setTo(b) }}>{label}</button>
          ))}
        </div>
      </Filters>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Sales" value={`Rs ${rs(s?.revenue)}`} hint={`${s?.invoices ?? 0} invoices · ${s?.unitsSold ?? 0} units + ${s?.freeUnits ?? 0} free`} />
        <Stat label="Gross profit" value={`Rs ${rs(s?.profit)}`} tone={(s?.profit ?? 0) < 0 ? 'bad' : 'good'} hint={`${s?.margin ?? 0}% margin · vs purchase cost`} />
        <Stat label="Cash collected" value={`Rs ${rs(s?.collected)}`} hint={`To collect now Rs ${rs(s?.receivable)}`} />
        <Stat label="Purchases" value={`Rs ${rs(s?.purchases)}`} hint={`Paid out Rs ${rs(s?.paidOut)} · owe Rs ${rs(s?.payable)}`} />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: 'product', label: 'By product' },
          { key: 'customer', label: 'By customer' },
          { key: 'type', label: 'Shops vs medical centers' },
          { key: 'daily', label: 'Daily' },
          { key: 'aging', label: 'Unpaid (aging)' },
        ]} />
        <button className="btn-secondary mb-4" onClick={exportExcel}><FileSpreadsheet size={16} /> Excel</button>
      </div>

      {data.isLoading ? <Spinner /> : (
        <>
          {tab === 'product' && (
            <ClientTable<ByProduct> rows={(data.data ?? []) as ByProduct[]} rowKey={(r) => r.productId} initialSort={{ key: 'revenue', dir: 'desc' }} empty="No sales in this period." columns={[
              { key: 'item', header: 'Item', sortKey: 'item', sortValue: (r) => r.label, render: (r) => <Link className="hover:underline" to={`/products/${r.productId}`}>{r.label}</Link> },
              { key: 'qty', header: 'Qty', align: 'right', sortKey: 'qty', sortValue: (r) => r.qty, render: (r) => <>{r.qty}{r.free ? <span className="text-brand-700"> +{r.free}</span> : ''}</> },
              { key: 'revenue', header: 'Sales', ...money('revenue') },
              { key: 'cost', header: 'Cost', ...money('cost'), hideBelow: 'lg' },
              { key: 'profit', header: 'Profit', ...money('profit') },
              margin,
            ]} />
          )}
          {tab === 'customer' && (
            <ClientTable<ByCustomer> rows={(data.data ?? []) as ByCustomer[]} rowKey={(r) => r.customerId} initialSort={{ key: 'revenue', dir: 'desc' }} empty="No sales in this period." columns={[
              { key: 'name', header: 'Customer', sortKey: 'name', sortValue: (r) => r.name, render: (r) => <Link className="hover:underline" to={`/customers/${r.customerId}`}>{r.name}</Link> },
              { key: 'type', header: 'Type', hideBelow: 'lg', render: (r) => <Badge tone="blue">{r.typeName}</Badge> },
              { key: 'area', header: 'Area', hideBelow: 'xl', render: (r) => r.area },
              { key: 'inv', header: 'Invoices', align: 'right', sortKey: 'invoices', sortValue: (r) => r.invoices, render: (r) => r.invoices },
              { key: 'revenue', header: 'Sales', ...money('revenue') },
              { key: 'profit', header: 'Profit', ...money('profit') },
              margin,
            ]} />
          )}
          {tab === 'type' && (
            <ClientTable<ByType> rows={(data.data ?? []) as ByType[]} rowKey={(r) => r.typeId} columns={[
              { key: 'name', header: 'Customer type', render: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'cust', header: 'Customers', align: 'right', render: (r) => r.customers },
              { key: 'inv', header: 'Invoices', align: 'right', render: (r) => r.invoices },
              { key: 'revenue', header: 'Sales', ...money('revenue') },
              { key: 'profit', header: 'Profit', ...money('profit') },
              margin,
            ]} />
          )}
          {tab === 'daily' && (
            <ClientTable<Daily> rows={(data.data ?? []) as Daily[]} rowKey={(r) => r.date} initialSort={{ key: 'date', dir: 'desc' }} empty="No sales in this period." columns={[
              { key: 'date', header: 'Date', sortKey: 'date', sortValue: (r) => r.date, render: (r) => <Link className="hover:underline" to={`/sales?from=${r.date}&to=${r.date}`}>{r.date}</Link> },
              { key: 'inv', header: 'Invoices', align: 'right', render: (r) => r.invoices },
              { key: 'revenue', header: 'Sales', ...money('revenue') },
              { key: 'collected', header: 'Paid on invoice', align: 'right', hideBelow: 'lg', render: (r) => rs(r.collected) },
              { key: 'profit', header: 'Profit', ...money('profit') },
            ]} />
          )}
          {tab === 'aging' && (
            <ClientTable<Aging> rows={(data.data ?? []) as Aging[]} rowKey={(r) => r.customerId} initialSort={{ key: 'total', dir: 'desc' }} empty="Nobody owes you money. 🎉" columns={[
              { key: 'name', header: 'Customer', sortKey: 'name', sortValue: (r) => r.name, render: (r) => <Link className="hover:underline" to={`/customers/${r.customerId}`}>{r.name}<span className="ml-1.5 text-xs text-stone-400">{r.typeName}</span></Link> },
              { key: 'phone', header: 'Phone', hideBelow: 'lg', render: (r) => r.phone },
              { key: 'current', header: 'Not due', align: 'right', render: (r) => (r.current ? rs(r.current) : '') },
              { key: 'd30', header: '1–30 days', align: 'right', render: (r) => (r.d30 ? <span className="text-amber-700">{rs(r.d30)}</span> : '') },
              { key: 'd60', header: '31–60', align: 'right', render: (r) => (r.d60 ? <span className="text-orange-700">{rs(r.d60)}</span> : '') },
              { key: 'd90', header: '61–90', align: 'right', hideBelow: 'lg', render: (r) => (r.d90 ? <span className="text-red-600">{rs(r.d90)}</span> : '') },
              { key: 'd90p', header: '90+', align: 'right', hideBelow: 'lg', render: (r) => (r.d90plus ? <span className="font-semibold text-red-700">{rs(r.d90plus)}</span> : '') },
              { key: 'total', header: 'Total', align: 'right', sortKey: 'total', sortValue: (r) => r.total, render: (r) => <span className="font-semibold">{rs(r.total)}</span> },
            ]} />
          )}
        </>
      )}
    </div>
  )
}
