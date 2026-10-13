import { Router } from 'express'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { addDays, daysBetween, rs, round2, settingsSchema, todayLK, type Alert } from '@pjd/shared'
import type { DB } from '../db/client'
import * as schema from '../db/schema'
import { parse } from '../errors'
import { customerDues } from '../services/dues'
import { rows } from '../services/stock'
import { productsWithStock } from './catalog'
import { customersWithBalance, suppliersWithBalance } from './parties'

const range = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export function insightRoutes(db: DB) {
  const r = Router()

  // ---------------- settings
  r.get('/settings', async (_req, res) => {
    const [s] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1))
    const { id: _id, ...rest } = s
    res.json(rest)
  })
  r.put('/settings', async (req, res) => {
    const input = parse(settingsSchema, req.body)
    const [s] = await db.update(schema.settings).set(input).where(eq(schema.settings.id, 1)).returning()
    const { id: _id, ...rest } = s
    res.json(rest)
  })

  // ---------------- reports
  r.get('/reports/summary', async (req, res) => {
    const { from, to } = range.parse(req.query)
    const [[sales], [purch], [collected], [paidOut], customers, suppliers, products] = await Promise.all([
      rows<{ n: number; revenue: number; cost: number; units: number; free: number }>(db, sql`
        select count(*)::int as n, coalesce(sum(net_total), 0) as revenue, coalesce(sum(cost_total), 0) as cost,
               coalesce((select sum(qty) from sales_lines sl join sales_invoices s2 on s2.id = sl.invoice_id where s2.date between ${from} and ${to}), 0)::int as units,
               coalesce((select sum(free_qty) from sales_lines sl join sales_invoices s2 on s2.id = sl.invoice_id where s2.date between ${from} and ${to}), 0)::int as free
        from sales_invoices where date between ${from} and ${to}`),
      rows<{ n: number; total: number }>(db, sql`select count(*)::int as n, coalesce(sum(net_total), 0) as total from purchase_invoices where date between ${from} and ${to}`),
      rows<{ total: number }>(db, sql`select
        coalesce((select sum(paid_on_invoice) from sales_invoices where date between ${from} and ${to}), 0) +
        coalesce((select sum(amount) from payments where party_type = 'customer' and date between ${from} and ${to}), 0) as total`),
      rows<{ total: number }>(db, sql`select
        coalesce((select sum(paid_on_invoice) from purchase_invoices where date between ${from} and ${to}), 0) +
        coalesce((select sum(amount) from payments where party_type = 'supplier' and date between ${from} and ${to}), 0) as total`),
      customersWithBalance(db),
      suppliersWithBalance(db),
      productsWithStock(db),
    ])
    const profit = round2(sales.revenue - sales.cost)
    res.json({
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
    })
  })

  r.get('/reports/by-product', async (req, res) => {
    const { from, to } = range.parse(req.query)
    const list = await rows<{ productId: number; code: string; label: string; qty: number; free: number; revenue: number; cost: number; invoices: number }>(db, sql`
      select p.id as "productId", p.code, p.size || ' ' || p.name as label,
             sum(sl.qty)::int as qty, sum(sl.free_qty)::int as free,
             sum(sl.line_net * (1 - si.bill_disc_pct / 100)) as revenue,
             sum(sl.unit_cost * (sl.qty + sl.free_qty)) as cost,
             count(distinct si.id)::int as invoices
      from sales_lines sl join sales_invoices si on si.id = sl.invoice_id join products p on p.id = sl.product_id
      where si.date between ${from} and ${to}
      group by p.id order by revenue desc`)
    res.json(list.map((x) => ({ ...x, revenue: round2(x.revenue), cost: round2(x.cost), profit: round2(x.revenue - x.cost) })))
  })

  r.get('/reports/by-customer', async (req, res) => {
    const { from, to } = range.parse(req.query)
    const list = await rows<{ customerId: number; name: string; typeName: string; area: string; invoices: number; revenue: number; cost: number }>(db, sql`
      select c.id as "customerId", c.name, ct.name as "typeName", c.area, count(*)::int as invoices,
             sum(si.net_total) as revenue, sum(si.cost_total) as cost
      from sales_invoices si join customers c on c.id = si.customer_id join customer_types ct on ct.id = c.type_id
      where si.date between ${from} and ${to}
      group by c.id, ct.name order by revenue desc`)
    res.json(list.map((x) => ({ ...x, revenue: round2(x.revenue), cost: round2(x.cost), profit: round2(x.revenue - x.cost) })))
  })

  r.get('/reports/by-type', async (req, res) => {
    const { from, to } = range.parse(req.query)
    const list = await rows<{ typeId: number; name: string; customers: number; invoices: number; revenue: number; cost: number }>(db, sql`
      select ct.id as "typeId", ct.name, count(distinct c.id)::int as customers, count(si.id)::int as invoices,
             coalesce(sum(si.net_total), 0) as revenue, coalesce(sum(si.cost_total), 0) as cost
      from customer_types ct
      left join customers c on c.type_id = ct.id
      left join sales_invoices si on si.customer_id = c.id and si.date between ${from} and ${to}
      group by ct.id order by revenue desc`)
    res.json(list.map((x) => ({ ...x, revenue: round2(x.revenue), cost: round2(x.cost), profit: round2(x.revenue - x.cost) })))
  })

  r.get('/reports/daily', async (req, res) => {
    const { from, to } = range.parse(req.query)
    const list = await rows<{ date: string; invoices: number; revenue: number; cost: number; collected: number }>(db, sql`
      select si.date::text as date, count(*)::int as invoices, sum(si.net_total) as revenue, sum(si.cost_total) as cost,
             sum(si.paid_on_invoice) as collected
      from sales_invoices si where si.date between ${from} and ${to}
      group by si.date order by si.date`)
    res.json(list.map((x) => ({ ...x, revenue: round2(x.revenue), cost: round2(x.cost), profit: round2(x.revenue - x.cost) })))
  })

  /** Unpaid customer invoices grouped by how late they are. */
  r.get('/reports/aging', async (_req, res) => {
    const today = todayLK()
    const [invoices, dues] = await Promise.all([
      rows<{ id: number; customer_id: number; name: string; type_name: string; phone: string }>(db, sql`
        select si.id, si.customer_id, c.name, ct.name as type_name, c.phone
        from sales_invoices si join customers c on c.id = si.customer_id join customer_types ct on ct.id = c.type_id`),
      customerDues(db, today),
    ])
    const byCustomer = new Map<number, { customerId: number; name: string; typeName: string; phone: string; current: number; d30: number; d60: number; d90: number; d90plus: number; total: number }>()
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
    res.json([...byCustomer.values()].sort((a, b) => b.total - a.total))
  })

  // ---------------- dashboard
  r.get('/dashboard', async (_req, res) => {
    const today = todayLK()
    const monthStart = today.slice(0, 8) + '01'
    const yesterday = addDays(today, -1)
    // same days of last month (1st → today's day number, clamped to that month's end)
    const prevStart = addDays(monthStart, -1).slice(0, 8) + '01'
    const prevMonthEnd = addDays(monthStart, -1)
    const prevEnd = prevStart.slice(0, 8) + String(Math.min(Number(today.slice(8)), Number(prevMonthEnd.slice(8)))).padStart(2, '0')
    const from30 = addDays(today, -29)
    const [[y], [pm], daily] = await Promise.all([
      rows<{ revenue: number; n: number }>(db, sql`select coalesce(sum(net_total), 0) as revenue, count(*)::int as n from sales_invoices where date = ${yesterday}`),
      rows<{ revenue: number; cost: number }>(db, sql`select coalesce(sum(net_total), 0) as revenue, coalesce(sum(cost_total), 0) as cost from sales_invoices where date >= ${prevStart} and date <= ${prevEnd}`),
      rows<{ date: string; revenue: number; n: number }>(db, sql`select date::text as date, sum(net_total) as revenue, count(*)::int as n from sales_invoices where date >= ${from30} and date <= ${today} group by date`),
    ])
    const dayMap = new Map(daily.map((d) => [d.date, d]))
    const last30 = Array.from({ length: 30 }, (_, i) => {
      const date = addDays(from30, i)
      const d = dayMap.get(date)
      return { date, revenue: round2(d?.revenue ?? 0), invoices: d?.n ?? 0 }
    })
    const [[t], [m], recent, top, byType, products, customers, suppliers] = await Promise.all([
      rows<{ revenue: number; n: number; collected: number }>(db, sql`
        select coalesce(sum(net_total), 0) as revenue, count(*)::int as n,
               coalesce(sum(paid_on_invoice), 0) + coalesce((select sum(amount) from payments where party_type = 'customer' and date = ${today}), 0) as collected
        from sales_invoices where date = ${today}`),
      rows<{ revenue: number; cost: number; n: number }>(db, sql`select coalesce(sum(net_total), 0) as revenue, coalesce(sum(cost_total), 0) as cost, count(*)::int as n from sales_invoices where date >= ${monthStart} and date <= ${today}`),
      rows(db, sql`select si.id, si.invoice_no as "invoiceNo", si.date::text as date, si.net_total as "netTotal", c.name as "customerName", ct.name as "typeName"
                   from sales_invoices si join customers c on c.id = si.customer_id join customer_types ct on ct.id = c.type_id
                   order by si.date desc, si.id desc limit 8`),
      rows<{ productId: number; label: string; revenue: number; qty: number }>(db, sql`
        select p.id as "productId", p.size || ' ' || p.name as label, sum(sl.line_net * (1 - si.bill_disc_pct / 100)) as revenue, sum(sl.qty)::int as qty
        from sales_lines sl join sales_invoices si on si.id = sl.invoice_id join products p on p.id = sl.product_id
        where si.date >= ${monthStart} and si.date <= ${today}
        group by p.id order by revenue desc limit 6`),
      rows<{ name: string; revenue: number }>(db, sql`
        select ct.name, coalesce(sum(si.net_total), 0) as revenue from customer_types ct
        left join customers c on c.type_id = ct.id left join sales_invoices si on si.customer_id = c.id and si.date >= ${monthStart} and si.date <= ${today}
        group by ct.id, ct.sort order by ct.sort`),
      productsWithStock(db),
      customersWithBalance(db),
      suppliersWithBalance(db),
    ])
    const active = products.filter((p) => p.active)
    res.json({
      today: { revenue: round2(t.revenue), invoices: t.n, collected: round2(t.collected), yesterday: round2(y.revenue) },
      month: { revenue: round2(m.revenue), profit: round2(m.revenue - m.cost), invoices: m.n, lastMonthSameDays: round2(pm.revenue), lastMonthProfit: round2(pm.revenue - pm.cost) },
      last30,
      toCollect: customers
        .filter((c) => c.balance > 0.004)
        .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance)
        .slice(0, 6)
        .map((c) => ({ id: c.id, name: c.name, typeName: c.typeName, phone: c.phone, balance: c.balance, overdue: c.overdue, oldestDueDate: c.oldestDueDate, overLimit: c.overLimit })),
      counts: { customers: customers.filter((c) => c.active).length, products: active.length },
      stock: {
        costValue: round2(products.reduce((s, p) => s + p.stockValue, 0)),
        sellValue: round2(products.reduce((s, p) => s + Math.max(p.onHand, 0) * p.sellPrice, 0)),
        units: products.reduce((s, p) => s + Math.max(p.onHand, 0), 0),
        low: active.filter((p) => p.onHand > 0 && p.onHand <= p.reorderLevel).length,
        out: active.filter((p) => p.onHand <= 0).length,
      },
      receivable: round2(customers.reduce((s, c) => s + Math.max(c.balance, 0), 0)),
      overdue: round2(customers.reduce((s, c) => s + c.overdue, 0)),
      payable: round2(suppliers.reduce((s, c) => s + Math.max(c.balance, 0), 0)),
      recent,
      topProducts: top.map((x) => ({ ...x, revenue: round2(x.revenue) })),
      byType: byType.map((x) => ({ ...x, revenue: round2(x.revenue) })),
      lowStock: active
        .filter((p) => p.onHand <= p.reorderLevel)
        .sort((a, b) => a.onHand - b.onHand)
        .slice(0, 12)
        .map((p) => ({ id: p.id, code: p.code, label: `${p.size} ${p.name}`, onHand: p.onHand, reorderLevel: p.reorderLevel })),
    })
  })

  // ---------------- alerts (notification bell)
  r.get('/alerts', async (_req, res) => {
    const today = todayLK()
    const [products, customers, suppliers, promos] = await Promise.all([
      productsWithStock(db),
      customersWithBalance(db),
      suppliersWithBalance(db),
      rows<{ id: number; name: string; label: string; end_date: string }>(db, sql`
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
    res.json(alerts)
  })

  // ---------------- full JSON export (backup)
  r.get('/export', async (_req, res) => {
    const tables = {
      settings: schema.settings, customerTypes: schema.customerTypes, products: schema.products, priceRules: schema.priceRules,
      promotions: schema.promotions, customers: schema.customers, suppliers: schema.suppliers, salesInvoices: schema.salesInvoices,
      salesLines: schema.salesLines, purchaseInvoices: schema.purchaseInvoices, purchaseLines: schema.purchaseLines,
      payments: schema.payments, stockAdjustments: schema.stockAdjustments,
    }
    const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), version: 2 }
    for (const [k, t] of Object.entries(tables)) out[k] = await db.select().from(t as typeof schema.products)
    res.setHeader('Content-Disposition', `attachment; filename="pasyala-erp-${today()}.json"`)
    res.json(out)
  })

  return r
}

const today = () => todayLK()
