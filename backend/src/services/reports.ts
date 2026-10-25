// Report queries shared by the Reports page (routes/insights.ts), the notification bell and the assistant,
// so every screen and the assistant always show the same figures.
import { sql } from 'drizzle-orm'
import { addDays, daysBetween, round2, rs, todayLK, type Alert } from '@pjd/shared'
import type { Executor } from '../db/client'
import { productsWithStock } from '../routes/catalog'
import { customersWithBalance, suppliersWithBalance } from '../routes/parties'
import { customerDues } from './dues'
import { rows } from './stock'

export interface Profit {
  revenue: number
  cost: number
  profit: number
}
export type ByProductRow = Profit & { productId: number; code: string; label: string; qty: number; free: number; invoices: number }
export type ByCustomerRow = Profit & { customerId: number; name: string; typeName: string; area: string; invoices: number }
export type ByTypeRow = Profit & { typeId: number; name: string; customers: number; invoices: number }
export type DailyRow = Profit & { date: string; invoices: number; collected: number }
export interface AgingRow {
  customerId: number
  name: string
  typeName: string
  phone: string
  current: number
  d30: number
  d60: number
  d90: number
  d90plus: number
  total: number
}
export interface ReportSummary {
  invoices: number
  revenue: number
  cost: number
  profit: number
  margin: number
  unitsSold: number
  freeUnits: number
  purchases: number
  purchaseCount: number
  collected: number
  paidOut: number
  /** balances as of today, not for the period */
  receivable: number
  overdue: number
  payable: number
  stockValue: number
}

const withProfit = <T extends { revenue: number; cost: number }>(x: T) => ({ ...x, revenue: round2(x.revenue), cost: round2(x.cost), profit: round2(x.revenue - x.cost) })

/** Sales, cost, profit, purchases and money in/out for a date range, plus today's balances and stock value. */
export async function reportSummary(ex: Executor, from: string, to: string): Promise<ReportSummary> {
  const [[sales], [purch], [collected], [paidOut], customers, suppliers, products] = await Promise.all([
    rows<{ n: number; revenue: number; cost: number; units: number; free: number }>(ex, sql`
      select count(*)::int as n, coalesce(sum(net_total), 0) as revenue, coalesce(sum(cost_total), 0) as cost,
             coalesce((select sum(qty) from sales_lines sl join sales_invoices s2 on s2.id = sl.invoice_id where s2.date between ${from} and ${to}), 0)::int as units,
             coalesce((select sum(free_qty) from sales_lines sl join sales_invoices s2 on s2.id = sl.invoice_id where s2.date between ${from} and ${to}), 0)::int as free
      from sales_invoices where date between ${from} and ${to}`),
    rows<{ n: number; total: number }>(ex, sql`select count(*)::int as n, coalesce(sum(net_total), 0) as total from purchase_invoices where date between ${from} and ${to}`),
    rows<{ total: number }>(ex, sql`select
      coalesce((select sum(paid_on_invoice) from sales_invoices where date between ${from} and ${to}), 0) +
      coalesce((select sum(amount) from payments where party_type = 'customer' and date between ${from} and ${to}), 0) as total`),
    rows<{ total: number }>(ex, sql`select
      coalesce((select sum(paid_on_invoice) from purchase_invoices where date between ${from} and ${to}), 0) +
      coalesce((select sum(amount) from payments where party_type = 'supplier' and date between ${from} and ${to}), 0) as total`),
    customersWithBalance(ex),
    suppliersWithBalance(ex),
    productsWithStock(ex),
  ])
  const profit = round2(sales.revenue - sales.cost)
  return {
    invoices: sales.n,
    revenue: round2(sales.revenue),
    cost: round2(sales.cost),
    profit,
    margin: sales.revenue ? round2((profit / sales.revenue) * 100) : 0,
    unitsSold: sales.units,
    freeUnits: sales.free,
    purchases: round2(purch.total),
    purchaseCount: purch.n,
    collected: round2(collected.total),
    paidOut: round2(paidOut.total),
    receivable: round2(customers.reduce((s, c) => s + Math.max(c.balance, 0), 0)),
    overdue: round2(customers.reduce((s, c) => s + c.overdue, 0)),
    payable: round2(suppliers.reduce((s, c) => s + Math.max(c.balance, 0), 0)),
    stockValue: round2(products.reduce((s, p) => s + p.stockValue, 0)),
  }
}

export async function salesByProduct(ex: Executor, from: string, to: string): Promise<ByProductRow[]> {
  const list = await rows<{ productId: number; code: string; label: string; qty: number; free: number; revenue: number; cost: number; invoices: number }>(ex, sql`
    select p.id as "productId", p.code, p.size || ' ' || p.name as label,
           sum(sl.qty)::int as qty, sum(sl.free_qty)::int as free,
           sum(sl.line_net * (1 - si.bill_disc_pct / 100)) as revenue,
           sum(sl.unit_cost * (sl.qty + sl.free_qty)) as cost,
           count(distinct si.id)::int as invoices
    from sales_lines sl join sales_invoices si on si.id = sl.invoice_id join products p on p.id = sl.product_id
    where si.date between ${from} and ${to}
    group by p.id order by revenue desc`)
  return list.map(withProfit)
}

export async function salesByCustomer(ex: Executor, from: string, to: string): Promise<ByCustomerRow[]> {
  const list = await rows<{ customerId: number; name: string; typeName: string; area: string; invoices: number; revenue: number; cost: number }>(ex, sql`
    select c.id as "customerId", c.name, ct.name as "typeName", c.area, count(*)::int as invoices,
           sum(si.net_total) as revenue, sum(si.cost_total) as cost
    from sales_invoices si join customers c on c.id = si.customer_id join customer_types ct on ct.id = c.type_id
    where si.date between ${from} and ${to}
    group by c.id, ct.name order by revenue desc`)
  return list.map(withProfit)
}

export async function salesByType(ex: Executor, from: string, to: string): Promise<ByTypeRow[]> {
  const list = await rows<{ typeId: number; name: string; customers: number; invoices: number; revenue: number; cost: number }>(ex, sql`
    select ct.id as "typeId", ct.name, count(distinct c.id)::int as customers, count(si.id)::int as invoices,
           coalesce(sum(si.net_total), 0) as revenue, coalesce(sum(si.cost_total), 0) as cost
    from customer_types ct
    left join customers c on c.type_id = ct.id
    left join sales_invoices si on si.customer_id = c.id and si.date between ${from} and ${to}
    group by ct.id order by revenue desc`)
  return list.map(withProfit)
}

export async function salesDaily(ex: Executor, from: string, to: string): Promise<DailyRow[]> {
  const list = await rows<{ date: string; invoices: number; revenue: number; cost: number; collected: number }>(ex, sql`
    select si.date::text as date, count(*)::int as invoices, sum(si.net_total) as revenue, sum(si.cost_total) as cost,
           sum(si.paid_on_invoice) as collected
    from sales_invoices si where si.date between ${from} and ${to}
    group by si.date order by si.date`)
  return list.map(withProfit)
}

/** Unpaid customer invoices grouped by how late they are (current, 1–30, 31–60, 61–90, 90+ days). */
export async function agingReport(ex: Executor, today = todayLK()): Promise<AgingRow[]> {
  const [invoices, dues] = await Promise.all([
    rows<{ id: number; customer_id: number; name: string; type_name: string; phone: string }>(ex, sql`
      select si.id, si.customer_id, c.name, ct.name as type_name, c.phone
      from sales_invoices si join customers c on c.id = si.customer_id join customer_types ct on ct.id = c.type_id`),
    customerDues(ex, today),
  ])
  const byCustomer = new Map<number, AgingRow>()
  for (const inv of invoices) {
    const d = dues.byInvoice.get(inv.id)
    if (!d || d.due <= 0.004) continue
    const row = byCustomer.get(inv.customer_id) ?? { customerId: inv.customer_id, name: inv.name, typeName: inv.type_name, phone: inv.phone, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, total: 0 }
    const late = daysBetween(d.dueDate, today)
    const key = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'd90plus'
    row[key] = round2(row[key] + d.due)
    row.total = round2(row.total + d.due)
    byCustomer.set(inv.customer_id, row)
  }
  return [...byCustomer.values()].sort((a, b) => b.total - a.total)
}

/** What the notification bell shows: stock-outs, low stock, overdue customers, credit limits, supplier dues, ending promotions. */
export async function buildAlerts(ex: Executor, today = todayLK()): Promise<Alert[]> {
  const [products, customers, suppliers, promos] = await Promise.all([
    productsWithStock(ex),
    customersWithBalance(ex),
    suppliersWithBalance(ex),
    rows<{ id: number; name: string; label: string; end_date: string }>(ex, sql`
      select pr.id, pr.name, p.size || ' ' || p.name as label, pr.end_date::text as end_date
      from promotions pr join products p on p.id = pr.product_id
      where pr.active and pr.end_date is not null and pr.end_date between ${today} and ${addDays(today, 7)}`),
  ])
  const alerts: Alert[] = []
  const out = products.filter((p) => p.active && p.onHand <= 0)
  const low = products.filter((p) => p.active && p.onHand > 0 && p.onHand <= p.reorderLevel)
  if (out.length) alerts.push({ id: 'stock-out', level: 'danger', title: `${out.length} item${out.length > 1 ? 's' : ''} out of stock`, message: out.slice(0, 4).map((p) => `${p.size} ${p.name}`).join(', ') + (out.length > 4 ? '…' : ''), link: '/stock?stock=out' })
  if (low.length) alerts.push({ id: 'stock-low', level: 'warning', title: `${low.length} item${low.length > 1 ? 's' : ''} running low`, message: low.slice(0, 4).map((p) => `${p.size} ${p.name} (${p.onHand})`).join(', ') + (low.length > 4 ? '…' : ''), link: '/stock?stock=low' })
  for (const c of customers.filter((x) => x.overdue > 0.004).sort((a, b) => b.overdue - a.overdue).slice(0, 10)) {
    alerts.push({ id: `overdue-${c.id}`, level: 'danger', title: `${c.name}: Rs ${rs(c.overdue)} overdue`, message: `Oldest due ${c.oldestDueDate} · ${c.typeName}`, link: `/customers/${c.id}` })
  }
  for (const c of customers.filter((x) => x.overLimit)) {
    alerts.push({ id: `limit-${c.id}`, level: 'warning', title: `${c.name} is over credit limit`, message: `Balance Rs ${rs(c.balance)} · limit Rs ${rs(c.creditLimit)}`, link: `/customers/${c.id}` })
  }
  for (const s of suppliers.filter((x) => x.overdue > 0.004)) {
    alerts.push({ id: `sup-${s.id}`, level: 'warning', title: `Pay ${s.name}: Rs ${rs(s.overdue)} overdue`, message: `Oldest due ${s.oldestDueDate}`, link: `/suppliers/${s.id}` })
  }
  for (const p of promos) {
    alerts.push({ id: `promo-${p.id}`, level: 'info', title: `Promotion ending ${p.end_date}`, message: `${p.name || 'Free issue'} on ${p.label}`, link: '/pricing?tab=promotions' })
  }
  return alerts
}
