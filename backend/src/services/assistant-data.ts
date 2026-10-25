// Reads for the ERP Assistant. Everything comes from the same functions the screens use (productsWithStock,
// productMovements, customersWithBalance, customerDues, getSale, reportSummary …), so the assistant can never
// disagree with the Stock, Customers or Reports pages.
import { eq, sql, type SQL } from 'drizzle-orm'
import { addDays, quotePrice, round2, todayLK } from '@pjd/shared'
import type { Executor } from '../db/client'
import { assistantRequests, customers, products } from '../db/schema'
import { pricingContext, productsWithStock } from '../routes/catalog'
import { customersWithBalance, statement, suppliersWithBalance } from '../routes/parties'
import type { AdjustmentRequest, AssistantData, FoundInvoice, InvoiceListRow, PaymentRow, PurchaseLineRow, SalesLineRow, VelocityRow } from './assistant'
import { customerDues, supplierDues } from './dues'
import { getPurchase, getSale } from './invoices'
import { agingReport, buildAlerts, reportSummary, salesByCustomer, salesByProduct, salesByType, salesDaily } from './reports'
import { productMovements, rows, stockMap } from './stock'

function dateWindow(alias: string, from?: string, to?: string): SQL[] {
  const conds: SQL[] = []
  if (from) conds.push(sql`${sql.raw(alias)}.date >= ${from}`)
  if (to) conds.push(sql`${sql.raw(alias)}.date <= ${to}`)
  return conds
}
const whereOf = (conds: SQL[]) => (conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``)

/** Same matching as the list screens: every word must appear somewhere in the haystack. */
function matches(hay: string, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const h = hay.toLowerCase()
  return words.every((w) => h.includes(w))
}

const byStatus = <T extends { status: string; overdue: boolean }>(items: T[], status?: 'paid' | 'due' | 'overdue') =>
  status === 'paid' ? items.filter((i) => i.status === 'paid') : status === 'due' ? items.filter((i) => i.status !== 'paid') : status === 'overdue' ? items.filter((i) => i.overdue) : items

export function assistantData(db: Executor): AssistantData {
  return {
    // ------------------------------------------------------------ products & stock
    async searchProducts(query, limit) {
      const list = await productsWithStock(db)
      return list.filter((p) => matches(`${p.code} ${p.size} ${p.name} ${p.category}`, query)).slice(0, limit)
    },

    async getProduct(id) {
      return (await productsWithStock(db)).find((p) => p.id === id) ?? null
    },

    async movements(productId, limit, type) {
      let list = (await productMovements(db, productId)).reverse() // newest first, like GET /products/:id/movements
      if (type) list = list.filter((m) => m.type === type)
      return list.slice(0, limit)
    },

    // One row per GRN (a product can be on two lines of the same invoice, e.g. HOSI005942 THPN0750 3 + 6)
    async purchaseLines(productId, { from, to, limit }) {
      const where = sql.join([sql`pl.product_id = ${productId}`, ...dateWindow('pi', from, to)], sql` and `)
      return rows<PurchaseLineRow>(
        db,
        sql`select pi.invoice_no as "invoiceNo", pi.date::text as date, s.name as supplier,
                   sum(pl.qty)::int as qty, sum(pl.free_qty)::int as "freeQty",
                   max(pl.unit_price)::float as "unitPrice", max(pl.disc_pct)::float as "discPct",
                   pi.bill_disc_pct::float as "billDiscPct", sum(pl.line_net)::float as "lineNet"
            from purchase_lines pl
            join purchase_invoices pi on pi.id = pl.invoice_id
            join suppliers s on s.id = pi.supplier_id
            where ${where}
            group by pi.id, s.name
            order by pi.date desc, pi.created_at desc, pi.id desc
            limit ${limit}`,
      )
    },

    async salesLines(productId, { from, to, limit }) {
      const where = sql.join([sql`sl.product_id = ${productId}`, ...dateWindow('si', from, to)], sql` and `)
      return rows<SalesLineRow>(
        db,
        sql`select si.invoice_no as "invoiceNo", si.date::text as date, c.name as customer,
                   sum(sl.qty)::int as qty, sum(sl.free_qty)::int as "freeQty",
                   max(sl.unit_price)::float as "unitPrice", max(sl.disc_pct)::float as "discPct",
                   sum(sl.line_net)::float as "lineNet"
            from sales_lines sl
            join sales_invoices si on si.id = sl.invoice_id
            join customers c on c.id = si.customer_id
            where ${where}
            group by si.id, c.name
            order by si.date desc, si.created_at desc, si.id desc
            limit ${limit}`,
      )
    },

    async lowStock(limit) {
      // Same rule as the dashboard and the notification bell
      return (await productsWithStock(db))
        .filter((p) => p.active && p.onHand <= p.reorderLevel)
        .sort((a, b) => a.onHand - b.onHand)
        .slice(0, limit)
    },

    async stockOverview() {
      // Same figures as the dashboard: value over every product, low/out counts over active ones
      const all = await productsWithStock(db)
      const active = all.filter((p) => p.active)
      const cats = new Map<string, { category: string; products: number; units: number; costValue: number }>()
      for (const p of active) {
        const c = cats.get(p.category) ?? { category: p.category, products: 0, units: 0, costValue: 0 }
        c.products++
        c.units += Math.max(p.onHand, 0)
        c.costValue = round2(c.costValue + p.stockValue)
        cats.set(p.category, c)
      }
      return {
        activeProducts: active.length,
        units: all.reduce((s, p) => s + Math.max(p.onHand, 0), 0),
        costValue: round2(all.reduce((s, p) => s + p.stockValue, 0)),
        sellValue: round2(all.reduce((s, p) => s + Math.max(p.onHand, 0) * p.sellPrice, 0)),
        low: active.filter((p) => p.onHand > 0 && p.onHand <= p.reorderLevel).length,
        out: active.filter((p) => p.onHand <= 0).length,
        byCategory: [...cats.values()].sort((a, b) => b.costValue - a.costValue),
      }
    },

    async salesVelocity(days) {
      const today = todayLK()
      const from = addDays(today, -(days - 1))
      const sold = await rows<{ product_id: number; units: number; last_date: string | null }>(
        db,
        sql`select sl.product_id,
                   sum(case when si.date >= ${from} and si.date <= ${today} then sl.qty + sl.free_qty else 0 end)::int as units,
                   max(si.date)::text as last_date
            from sales_lines sl join sales_invoices si on si.id = sl.invoice_id
            group by sl.product_id`,
      )
      const map = new Map(sold.map((s) => [s.product_id, s]))
      return (await productsWithStock(db)).map((p): VelocityRow => {
        const s = map.get(p.id)
        const units = s?.units ?? 0
        const perDay = units / days
        return {
          id: p.id, code: p.code, label: `${p.size} ${p.name}`, active: p.active, onHand: p.onHand, reorderLevel: p.reorderLevel, stockValue: p.stockValue,
          soldInWindow: units,
          perDay: Math.round(perDay * 100) / 100,
          daysOfCover: perDay > 0 ? Math.round(Math.max(p.onHand, 0) / perDay) : null,
          lastSaleDate: s?.last_date ?? null,
        }
      })
    },

    async createRequest(r) {
      const [row] = await db
        .insert(assistantRequests)
        .values({ productId: r.productId, label: r.label, onHand: r.onHand, countedQty: r.countedQty, delta: r.delta, reason: r.reason, notes: r.notes, requestedBy: r.requestedBy })
        .returning()
      return toRequest(row)
    },

    // ------------------------------------------------------------ customers & suppliers
    async searchCustomers(query, limit) {
      return (await customersWithBalance(db)).filter((c) => matches(`${c.code} ${c.name} ${c.area} ${c.phone} ${c.typeName}`, query)).slice(0, limit)
    },

    async getCustomer(id) {
      const customer = (await customersWithBalance(db)).find((c) => c.id === id)
      if (!customer) return null
      return { customer, statement: await statement(db, 'customer', id) }
    },

    async searchSuppliers(query, limit) {
      return (await suppliersWithBalance(db)).filter((s) => matches(`${s.code} ${s.name} ${s.phone} ${s.address}`, query)).slice(0, limit)
    },

    async getSupplier(id) {
      const supplier = (await suppliersWithBalance(db)).find((s) => s.id === id)
      if (!supplier) return null
      return { supplier, statement: await statement(db, 'supplier', id) }
    },

    async receivables(filter, limit) {
      // Same filters as the Customers page; worst first like the dashboard's "to collect"
      const list = await customersWithBalance(db)
      const picked = filter === 'overdue' ? list.filter((c) => c.overdue > 0.004) : filter === 'overLimit' ? list.filter((c) => c.overLimit) : list.filter((c) => c.balance > 0.004)
      return picked.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance).slice(0, limit)
    },

    async payables(limit) {
      return (await suppliersWithBalance(db)).filter((s) => s.balance > 0.004).sort((a, b) => b.balance - a.balance).slice(0, limit)
    },

    async customerTypes() {
      return (await pricingContext(db)).types
    },

    // ------------------------------------------------------------ invoices & payments
    async listSales({ from, to, customerId, status, limit }) {
      const conds = dateWindow('si', from, to)
      if (customerId) conds.push(sql`si.customer_id = ${customerId}`)
      const [list, dues] = await Promise.all([
        rows<{ id: number; invoiceNo: string; date: string; party: string; payMethod: string; netTotal: number; costTotal: number; units: number; freeUnits: number }>(
          db,
          sql`select si.id, si.invoice_no as "invoiceNo", si.date::text as date, c.name as party, si.pay_method as "payMethod",
                     si.net_total::float as "netTotal", si.cost_total::float as "costTotal",
                     (select coalesce(sum(qty), 0) from sales_lines where invoice_id = si.id)::int as units,
                     (select coalesce(sum(free_qty), 0) from sales_lines where invoice_id = si.id)::int as "freeUnits"
              from sales_invoices si join customers c on c.id = si.customer_id
              ${whereOf(conds)}
              order by si.date desc, si.id desc`,
        ),
        customerDues(db),
      ])
      const items = list.map((i): InvoiceListRow => {
        const d = dues.byInvoice.get(i.id)!
        return { kind: 'sale', id: i.id, invoiceNo: i.invoiceNo, date: i.date, party: i.party, payMethod: i.payMethod, netTotal: i.netTotal, paid: d.paid, due: d.due, status: d.status, dueDate: d.dueDate, overdue: d.overdue, units: i.units, freeUnits: i.freeUnits, profit: round2(i.netTotal - i.costTotal) }
      })
      return byStatus(items, status).slice(0, limit)
    },

    async listPurchases({ from, to, supplierId, status, limit }) {
      const conds = dateWindow('pi', from, to)
      if (supplierId) conds.push(sql`pi.supplier_id = ${supplierId}`)
      const [list, dues] = await Promise.all([
        rows<{ id: number; invoiceNo: string; date: string; party: string; payMethod: string; netTotal: number; units: number; freeUnits: number }>(
          db,
          sql`select pi.id, pi.invoice_no as "invoiceNo", pi.date::text as date, s.name as party, pi.pay_method as "payMethod", pi.net_total::float as "netTotal",
                     (select coalesce(sum(qty), 0) from purchase_lines where invoice_id = pi.id)::int as units,
                     (select coalesce(sum(free_qty), 0) from purchase_lines where invoice_id = pi.id)::int as "freeUnits"
              from purchase_invoices pi join suppliers s on s.id = pi.supplier_id
              ${whereOf(conds)}
              order by pi.date desc, pi.created_at desc, pi.id desc`,
        ),
        supplierDues(db),
      ])
      const items = list.map((i): InvoiceListRow => {
        const d = dues.byInvoice.get(i.id)!
        return { kind: 'purchase', id: i.id, invoiceNo: i.invoiceNo, date: i.date, party: i.party, payMethod: i.payMethod, netTotal: i.netTotal, paid: d.paid, due: d.due, status: d.status, dueDate: d.dueDate, overdue: d.overdue, units: i.units, freeUnits: i.freeUnits }
      })
      return byStatus(items, status).slice(0, limit)
    },

    // "PJD-000012", "pjd 12" and "12" all find sales invoice PJD-000012 (the prefix comes from Settings);
    // GRN numbers match exactly (case-insensitive). Anything else, e.g. "NOPE-1", matches nothing.
    async findInvoice(invoiceNo) {
      const no = invoiceNo.trim().toUpperCase()
      const [cfg] = await rows<{ invoice_prefix: string }>(db, sql`select invoice_prefix from settings where id = 1`)
      const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '')
      const prefix = norm(cfg?.invoice_prefix ?? '')
      const compact = norm(no)
      let digits: string | null = null
      if (/^\d+$/.test(compact)) digits = compact
      else if (prefix && compact.startsWith(prefix) && /^\d+$/.test(compact.slice(prefix.length))) digits = compact.slice(prefix.length)
      if (digits) digits = digits.replace(/^0+/, '') || '0'
      const sales = await rows<{ id: number }>(
        db,
        sql`select id from sales_invoices where upper(invoice_no) = ${no} ${digits ? sql`or invoice_no ~ ${'(^|[^0-9])0*' + digits + '$'}` : sql``} order by id desc limit 5`,
      )
      const purchases = await rows<{ id: number }>(db, sql`select id from purchase_invoices where upper(invoice_no) = ${no} order by date desc, id desc limit 5`)
      const out: FoundInvoice[] = []
      for (const s of sales) out.push({ kind: 'sale', invoice: await getSale(db, s.id) })
      for (const p of purchases) out.push({ kind: 'purchase', invoice: await getPurchase(db, p.id) })
      return out
    },

    async listPayments({ from, to, partyType, partyId, limit }) {
      const conds = dateWindow('p', from, to)
      if (partyType) conds.push(sql`p.party_type = ${partyType}`)
      if (partyId) conds.push(sql`coalesce(p.customer_id, p.supplier_id) = ${partyId}`)
      return rows<PaymentRow>(
        db,
        sql`select p.id, p.date::text as date, p.party_type as "partyType", coalesce(c.name, s.name) as party,
                   p.amount::float as amount, p.method, p.reference, p.notes
            from payments p
            left join customers c on c.id = p.customer_id
            left join suppliers s on s.id = p.supplier_id
            ${whereOf(conds)}
            order by p.date desc, p.id desc
            limit ${limit}`,
      )
    },

    // ------------------------------------------------------------ reports & pricing (shared with the Reports page)
    summary: (from, to) => reportSummary(db, from, to),

    breakdown(by, from, to) {
      return by === 'product' ? salesByProduct(db, from, to) : by === 'customer' ? salesByCustomer(db, from, to) : by === 'customer_type' ? salesByType(db, from, to) : salesDaily(db, from, to)
    },

    aging: () => agingReport(db),

    alerts: () => buildAlerts(db),

    async priceQuote(productId, target, qty) {
      const [p] = await db.select().from(products).where(eq(products.id, productId))
      if (!p) return null
      const ctx = await pricingContext(db)
      let customer: { typeId: number; discPct: number | null } | null = null
      let customerName: string | null = null
      let typeId = target.customerTypeId ?? null
      if (target.customerId) {
        const [c] = await db.select().from(customers).where(eq(customers.id, target.customerId))
        if (!c) return null
        customer = { typeId: c.typeId, discPct: c.discPct }
        customerName = c.name
        typeId = c.typeId
      } else if (typeId) {
        customer = { typeId, discPct: null }
      }
      const q = quotePrice({ product: p, customer, ...ctx, qty, date: todayLK() })
      const avgCost = (await stockMap(db, [productId])).get(productId)?.avgCost ?? 0
      const type = ctx.types.find((t) => t.id === typeId)
      return {
        product: `${p.size} ${p.name}`,
        customer: customerName,
        customerType: type?.name ?? null,
        unitPrice: q.unitPrice,
        discPct: q.discPct,
        netUnitPrice: q.netUnitPrice,
        source: q.sourceLabel,
        promotion: q.promotion ? `${q.promotion.name || 'Free issue'}: buy ${q.promotion.buyQty} get ${q.promotion.freeQty} free` : null,
        freeQty: q.freeQty,
        avgCost,
        marginPct: q.netUnitPrice > 0 ? round2(((q.netUnitPrice - avgCost) / q.netUnitPrice) * 100) : 0,
      }
    },
  }
}

function toRequest(row: typeof assistantRequests.$inferSelect): AdjustmentRequest {
  return {
    id: row.id, productId: row.productId, label: row.label, onHand: row.onHand, countedQty: row.countedQty, delta: row.delta,
    reason: row.reason, notes: row.notes, requestedBy: row.requestedBy, status: row.status as AdjustmentRequest['status'],
  }
}
