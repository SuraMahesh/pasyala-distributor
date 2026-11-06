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
  /** sales returns in the period */
  returns: number
  /** invoice totals before returns */
  grossRevenue: number
  /** value of goods customers sent back */
  returned: number
  /** cash handed back on returns (already taken off `collected`) */
  refunded: number
  /** sales net of returns */
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

/**
 * Every sales line (+) and sales-return line (−) in a date range, with the money it brought in after the bill
 * discount and the cost of the goods. Summing these gives sales net of returns — the figure used everywhere.
 */
const lineMoves = (from: string, to: string) => sql`(
  select sl.product_id, si.customer_id, si.id as invoice_id, si.date, sl.qty, sl.free_qty,
         sl.line_net * (1 - si.bill_disc_pct / 100) as revenue, sl.unit_cost * (sl.qty + sl.free_qty) as cost
    from sales_lines sl join sales_invoices si on si.id = sl.invoice_id where si.date between ${from} and ${to}
  union all
  select rl.product_id, r.customer_id, null, r.date, -rl.qty, -rl.free_qty,
         -(rl.line_net * (1 - r.bill_disc_pct / 100)), -(rl.unit_cost * (rl.qty + rl.free_qty))
    from sales_return_lines rl join sales_returns r on r.id = rl.return_id where r.date between ${from} and ${to}
)`

/** Every sales invoice (+) and sales return (−) in a date range. `collected` = cash on the invoice / cash refunded. */
const docMoves = (from: string, to: string) => sql`(
  select customer_id, id as invoice_id, date, net_total as revenue, cost_total as cost, paid_on_invoice as collected
    from sales_invoices where date between ${from} and ${to}
  union all
  select customer_id, null, date, -net_total, -cost_total, -refunded
    from sales_returns where date between ${from} and ${to}
)`

export interface NetSales {
  invoices: number
  returns: number
  /** invoice totals before returns */
  grossRevenue: number
  /** value of the goods that came back */
  returned: number
  /** grossRevenue − returned */
  revenue: number
  cost: number
  /** cash handed back on returns */
  refunded: number
  units: number
  free: number
}

/** Sales less returns for a date range — the "Sales" figure on the dashboard, the reports and in the assistant. */
export async function netSales(ex: Executor, from: string, to: string): Promise<NetSales> {
  const [[d], [u]] = await Promise.all([
    rows<{ invoices: number; returns: number; gross: number; returned: number; revenue: number; cost: number; refunded: number }>(ex, sql`
      select count(invoice_id)::int as invoices, (count(*) - count(invoice_id))::int as returns,
             coalesce(sum(case when invoice_id is not null then revenue end), 0) as gross,
             coalesce(sum(case when invoice_id is null then -revenue end), 0) as returned,
             coalesce(sum(revenue), 0) as revenue, coalesce(sum(cost), 0) as cost,
             coalesce(sum(case when invoice_id is null then -collected end), 0) as refunded
      from ${docMoves(from, to)} m`),
    rows<{ units: number; free: number }>(ex, sql`select coalesce(sum(qty), 0)::int as units, coalesce(sum(free_qty), 0)::int as free from ${lineMoves(from, to)} m`),
  ])
  return {
    invoices: d.invoices,
    returns: d.returns,
    grossRevenue: round2(d.gross),
    returned: round2(d.returned),
    revenue: round2(d.revenue),
    cost: round2(d.cost),
    refunded: round2(d.refunded),
    units: u.units,
    free: u.free,
  }
}

/** Sales (net of returns), cost, profit, purchases and money in/out for a date range, plus today's balances and stock value. */
export async function reportSummary(ex: Executor, from: string, to: string): Promise<ReportSummary> {
  const [sales, [purch], [collected], [paidOut], customers, suppliers, products] = await Promise.all([
    netSales(ex, from, to),
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
    invoices: sales.invoices,
    returns: sales.returns,
    grossRevenue: sales.grossRevenue,
    returned: sales.returned,
    refunded: sales.refunded,
    revenue: sales.revenue,
    cost: sales.cost,
    profit,
    margin: sales.revenue ? round2((profit / sales.revenue) * 100) : 0,
    unitsSold: sales.units,
    freeUnits: sales.free,
    purchases: round2(purch.total),
    purchaseCount: purch.n,
    collected: round2(collected.total - sales.refunded),
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
           sum(m.qty)::int as qty, sum(m.free_qty)::int as free, sum(m.revenue) as revenue, sum(m.cost) as cost,
           count(distinct m.invoice_id)::int as invoices
    from ${lineMoves(from, to)} m join products p on p.id = m.product_id
    group by p.id order by revenue desc`)
  return list.map(withProfit)
}

export async function salesByCustomer(ex: Executor, from: string, to: string): Promise<ByCustomerRow[]> {
  const list = await rows<{ customerId: number; name: string; typeName: string; area: string; invoices: number; revenue: number; cost: number }>(ex, sql`
    select c.id as "customerId", c.name, ct.name as "typeName", c.area, count(m.invoice_id)::int as invoices,
           sum(m.revenue) as revenue, sum(m.cost) as cost
    from ${docMoves(from, to)} m join customers c on c.id = m.customer_id join customer_types ct on ct.id = c.type_id
    group by c.id, ct.name order by revenue desc`)
  return list.map(withProfit)
}

export async function salesByType(ex: Executor, from: string, to: string): Promise<ByTypeRow[]> {
  const list = await rows<{ typeId: number; name: string; customers: number; invoices: number; revenue: number; cost: number }>(ex, sql`
    select ct.id as "typeId", ct.name, count(distinct c.id)::int as customers, count(m.invoice_id)::int as invoices,
           coalesce(sum(m.revenue), 0) as revenue, coalesce(sum(m.cost), 0) as cost
    from customer_types ct
    left join customers c on c.type_id = ct.id
    left join ${docMoves(from, to)} m on m.customer_id = c.id
    group by ct.id order by revenue desc`)
  return list.map(withProfit)
}

export async function salesDaily(ex: Executor, from: string, to: string): Promise<DailyRow[]> {
  const list = await rows<{ date: string; invoices: number; revenue: number; cost: number; collected: number }>(ex, sql`
    select m.date::text as date, count(m.invoice_id)::int as invoices, sum(m.revenue) as revenue, sum(m.cost) as cost,
           sum(m.collected) as collected
    from ${docMoves(from, to)} m
    group by m.date order by m.date`)
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
