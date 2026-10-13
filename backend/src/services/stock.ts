import { sql, type SQL } from 'drizzle-orm'
import type { Movement, ProductStock } from '@pjd/shared'
import type { Executor } from '../db/client'
import { conflict } from '../errors'

export async function rows<T>(ex: Executor, query: SQL): Promise<T[]> {
  const res = (await ex.execute(query)) as unknown as { rows: T[] }
  return res.rows
}

interface StockRow {
  id: number
  code: string
  name: string
  size: string
  opening_stock: number
  list_price: number
  supplier_disc_pct: number
  purchased: number
  cost_sum: number
  free_in: number
  gross_in: number
  line_disc: number | null
  bill_disc: number | null
  sold: number
  free_out: number
  adjusted: number
}

/**
 * On hand = opening + purchased (incl. free) − sold (incl. free) + adjustments.
 * Avg cost = weighted landed cost of opening stock (at list − supplier disc) and every purchase
 * (line net after bill discount, spread over paid + free units).
 */
export async function stockMap(ex: Executor, productIds?: number[]) {
  const where = productIds?.length
    ? sql`where p.id in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``
  const list = await rows<StockRow>(
    ex,
    sql`
    select p.id, p.code, p.name, p.size, p.opening_stock, p.list_price, p.supplier_disc_pct,
      coalesce(pu.qty, 0)::int as purchased, coalesce(pu.cost, 0) as cost_sum,
      coalesce(pu.free_in, 0)::int as free_in, coalesce(pu.gross, 0) as gross_in,
      case when pu.gross > 0 then pu.line_disc_w / pu.gross end as line_disc,
      case when pu.gross > 0 then pu.bill_disc_w / pu.gross end as bill_disc,
      coalesce(sa.qty, 0)::int as sold, coalesce(sa.free_out, 0)::int as free_out, coalesce(ad.qty, 0)::int as adjusted
    from products p
    left join (
      select pl.product_id, sum(pl.qty + pl.free_qty) as qty,
             sum(pl.line_net * (1 - pi.bill_disc_pct / 100)) as cost,
             sum(pl.free_qty) as free_in,
             sum(pl.qty * pl.unit_price) as gross,
             sum(pl.qty * pl.unit_price * pl.disc_pct) as line_disc_w,
             sum(pl.qty * pl.unit_price * pi.bill_disc_pct) as bill_disc_w
      from purchase_lines pl join purchase_invoices pi on pi.id = pl.invoice_id
      group by pl.product_id
    ) pu on pu.product_id = p.id
    left join (select product_id, sum(qty + free_qty) as qty, sum(free_qty) as free_out from sales_lines group by product_id) sa on sa.product_id = p.id
    left join (select product_id, sum(qty) as qty from stock_adjustments group by product_id) ad on ad.product_id = p.id
    ${where}`,
  )
  const map = new Map<number, ProductStock & { label: string }>()
  for (const r of list) {
    const fallback = Number(r.list_price) * (1 - Number(r.supplier_disc_pct) / 100)
    const units = r.opening_stock + r.purchased
    const avgCost = units > 0 ? (r.opening_stock * fallback + Number(r.cost_sum)) / units : fallback
    map.set(r.id, {
      opening: r.opening_stock,
      purchased: r.purchased,
      sold: r.sold,
      adjusted: r.adjusted,
      onHand: r.opening_stock + r.purchased - r.sold + r.adjusted,
      avgCost: Math.round(avgCost * 10000) / 10000,
      freeIn: r.free_in,
      freeOut: r.free_out,
      lineDiscPct: r.line_disc == null ? Number(r.supplier_disc_pct) : Math.round(Number(r.line_disc) * 100) / 100,
      billDiscPct: r.bill_disc == null ? 0 : Math.round(Number(r.bill_disc) * 100) / 100,
      label: `${r.size} ${r.name} (${r.code})`,
    })
  }
  return map
}

export async function allowNegativeStock(ex: Executor) {
  const [s] = await rows<{ allow_negative_stock: boolean }>(ex, sql`select allow_negative_stock from settings where id = 1`)
  return s?.allow_negative_stock ?? false
}

/**
 * `deltas` = change in on-hand per product that is ABOUT to be written (negative = stock leaves).
 * Throws 409 listing every item that would go below zero, unless negative stock is allowed in settings.
 * Must be called inside the same transaction, before the write.
 */
export async function assertStockAvailable(ex: Executor, deltas: Map<number, number>) {
  const ids = [...deltas.entries()].filter(([, d]) => d < 0).map(([id]) => id)
  if (!ids.length || (await allowNegativeStock(ex))) return
  const stock = await stockMap(ex, ids)
  const short = ids
    .map((id) => {
      const s = stock.get(id)
      const after = (s?.onHand ?? 0) + (deltas.get(id) ?? 0)
      return { productId: id, label: s?.label ?? `#${id}`, onHand: s?.onHand ?? 0, after }
    })
    .filter((x) => x.after < 0)
  if (short.length) {
    throw conflict(
      `Not enough stock: ${short.map((s) => `${s.label} has ${s.onHand}, needs ${s.onHand - s.after}`).join('; ')}`,
      { short },
    )
  }
}

/** Sum qty+free per product for a set of lines (positive numbers). */
export function unitsByProduct(lines: { productId: number; qty: number; freeQty: number }[]) {
  const m = new Map<number, number>()
  for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty + l.freeQty)
  return m
}

export function mergeDeltas(...maps: [Map<number, number>, number][]) {
  const out = new Map<number, number>()
  for (const [m, sign] of maps) for (const [k, v] of m) out.set(k, (out.get(k) ?? 0) + v * sign)
  return out
}

export async function productMovements(ex: Executor, productId: number): Promise<Movement[]> {
  const list = await rows<Omit<Movement, 'balance'> & { sort_at: string }>(
    ex,
    sql`
    select * from (
      select '0000-00-00' as date, 'Opening' as type, '—' as ref, null::int as "refId", '' as party,
             opening_stock as "qtyIn", 0 as "qtyOut", '' as sort_at
        from products where id = ${productId} and opening_stock <> 0
      union all
      select pi.date::text, 'Purchase', pi.invoice_no, pi.id, s.name, sum(pl.qty + pl.free_qty)::int, 0, pi.created_at::text
        from purchase_lines pl join purchase_invoices pi on pi.id = pl.invoice_id join suppliers s on s.id = pi.supplier_id
        where pl.product_id = ${productId} group by pi.id, s.name
      union all
      select si.date::text, 'Sale', si.invoice_no, si.id, c.name, 0, sum(sl.qty + sl.free_qty)::int, si.created_at::text
        from sales_lines sl join sales_invoices si on si.id = sl.invoice_id join customers c on c.id = si.customer_id
        where sl.product_id = ${productId} group by si.id, c.name
      union all
      select a.date::text, 'Adjustment', a.reason, a.id, a.notes,
             greatest(a.qty, 0), greatest(-a.qty, 0), a.created_at::text
        from stock_adjustments a where a.product_id = ${productId}
    ) m order by date, sort_at`,
  )
  let bal = 0
  return list.map(({ sort_at: _s, ...m }) => {
    bal += m.qtyIn - m.qtyOut
    return { ...m, balance: bal }
  })
}

export interface BatchRow {
  productId: number
  invoiceId: number
  invoiceNo: string
  date: string
  qty: number
  freeQty: number
  unitPrice: number
  lineDiscPct: number
  billDiscPct: number
}

/** Every purchase line per product, oldest first (FIFO order). */
export async function stockBatches(ex: Executor) {
  const list = await rows<BatchRow>(
    ex,
    sql`select pl.product_id as "productId", pi.id as "invoiceId", pi.invoice_no as "invoiceNo", pi.date::text as date,
          pl.qty::int as qty, pl.free_qty::int as "freeQty", pl.unit_price as "unitPrice",
          pl.disc_pct as "lineDiscPct", pi.bill_disc_pct as "billDiscPct"
        from purchase_lines pl join purchase_invoices pi on pi.id = pl.invoice_id
        order by pi.date, pi.created_at, pi.id, pl.line_no`,
  )
  const map = new Map<number, BatchRow[]>()
  for (const r of list) {
    const b = { ...r, unitPrice: Number(r.unitPrice), lineDiscPct: Number(r.lineDiscPct), billDiscPct: Number(r.billDiscPct) }
    const arr = map.get(r.productId)
    if (arr) arr.push(b)
    else map.set(r.productId, [b])
  }
  return map
}
