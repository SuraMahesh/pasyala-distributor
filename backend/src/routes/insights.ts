import { Router } from 'express'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { addDays, dateString, round2, settingsSchema, todayLK } from '@pjd/shared'
import type { DB } from '../db/client'
import * as schema from '../db/schema'
import { parse } from '../errors'
import { agingReport, buildAlerts, reportSummary, salesByCustomer, salesByProduct, salesByType, salesDaily } from '../services/reports'
import { rows } from '../services/stock'
import { productsWithStock } from './catalog'
import { customersWithBalance, suppliersWithBalance } from './parties'

const range = z.object({ from: dateString, to: dateString })

export function insightRoutes(db: DB) {
  const r = Router()

  // ---------------- settings
  r.get('/settings', async (_req, res) => {
    const [s] = await db.select().from(schema.settings).where(eq(schema.settings.id, 1))
    res.json(publicSettings(s))
  })
  r.put('/settings', async (req, res) => {
    const input = parse(settingsSchema, req.body)
    const [s] = await db.update(schema.settings).set(input).where(eq(schema.settings.id, 1)).returning()
    res.json(publicSettings(s))
  })

  // ---------------- reports (queries live in services/reports.ts, shared with the assistant)
  r.get('/reports/summary', async (req, res) => {
    const { from, to } = range.parse(req.query)
    res.json(await reportSummary(db, from, to))
  })
  r.get('/reports/by-product', async (req, res) => {
    const { from, to } = range.parse(req.query)
    res.json(await salesByProduct(db, from, to))
  })
  r.get('/reports/by-customer', async (req, res) => {
    const { from, to } = range.parse(req.query)
    res.json(await salesByCustomer(db, from, to))
  })
  r.get('/reports/by-type', async (req, res) => {
    const { from, to } = range.parse(req.query)
    res.json(await salesByType(db, from, to))
  })
  r.get('/reports/daily', async (req, res) => {
    const { from, to } = range.parse(req.query)
    res.json(await salesDaily(db, from, to))
  })
  /** Unpaid customer invoices grouped by how late they are. */
  r.get('/reports/aging', async (_req, res) => {
    res.json(await agingReport(db))
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
    res.json(await buildAlerts(db))
  })

  // ---------------- full JSON export (backup)
  r.get('/export', async (_req, res) => {
    const tables = {
      settings: schema.settings, customerTypes: schema.customerTypes, products: schema.products, priceRules: schema.priceRules,
      promotions: schema.promotions, customers: schema.customers, suppliers: schema.suppliers, salesInvoices: schema.salesInvoices,
      salesLines: schema.salesLines, purchaseInvoices: schema.purchaseInvoices, purchaseLines: schema.purchaseLines,
      payments: schema.payments, stockAdjustments: schema.stockAdjustments, invoiceImages: schema.invoiceImages, assistantRequests: schema.assistantRequests,
    }
    const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), version: 3 }
    for (const [k, t] of Object.entries(tables)) {
      const list = (await db.select().from(t as typeof schema.products)) as Record<string, unknown>[]
      out[k] = k === 'settings' ? list.map(publicSettings) : list
    }
    res.setHeader('Content-Disposition', `attachment; filename="pasyala-erp-${today()}.json"`)
    res.json(out)
  })

  return r
}

const today = () => todayLK()

/** The settings row without its internal columns — the login signing secret must never leave the server. */
function publicSettings<T extends { id?: unknown; authSecret?: unknown }>(s: T) {
  const { id: _id, authSecret: _secret, ...rest } = s
  return rest
}
