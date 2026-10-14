import { sql } from 'drizzle-orm'
import type { PurchaseUsage, PurchaseUsageItem, PurchaseUsageSale } from '@pjd/shared'
import type { Executor } from '../db/client'
import { notFound } from '../errors'
import { rows } from './stock'

interface Layer {
  purchaseId: number | null
  qty: number
}
interface Out {
  kind: 'sale' | 'adjustment'
  id: number
  ref: string
  date: string
  party: string
  qty: number
}

/**
 * Which sales (and stock-out adjustments) took goods from this purchase invoice.
 * Stock is used oldest-first (FIFO): opening stock, then purchases / stock-in adjustments in date order.
 * Each sale takes from the oldest layer that still has goods.
 */
export async function purchaseUsage(ex: Executor, purchaseId: number): Promise<PurchaseUsage> {
  const [inv] = await rows<{ invoice_no: string }>(ex, sql`select invoice_no from purchase_invoices where id = ${purchaseId}`)
  if (!inv) throw notFound('Purchase invoice')
  const mine = await rows<{ product_id: number; qty: number; label: string }>(
    ex,
    sql`select pl.product_id, sum(pl.qty + pl.free_qty)::int as qty, p.size || ' ' || p.name as label
        from purchase_lines pl join products p on p.id = pl.product_id
        where pl.invoice_id = ${purchaseId} group by pl.product_id, p.size, p.name order by p.name`,
  )
  const items: PurchaseUsageItem[] = []
  for (const m of mine) {
    const [prod] = await rows<{ opening_stock: number }>(ex, sql`select opening_stock from products where id = ${m.product_id}`)
    const ins = await rows<{ purchase_id: number | null; qty: number }>(
      ex,
      sql`select * from (
            select pi.id as purchase_id, (pl.qty + pl.free_qty)::int as qty, pi.date, pi.created_at, pi.id as ord, pl.line_no as ord2
              from purchase_lines pl join purchase_invoices pi on pi.id = pl.invoice_id where pl.product_id = ${m.product_id}
            union all
            select null, a.qty::int, a.date, a.created_at, a.id, 0 from stock_adjustments a where a.product_id = ${m.product_id} and a.qty > 0
          ) x order by date, created_at, ord, ord2`,
    )
    const outs = await rows<Out>(
      ex,
      sql`select * from (
            select 'sale' as kind, si.id, si.invoice_no as ref, si.date::text as date, c.name as party, sum(sl.qty + sl.free_qty)::int as qty, si.created_at
              from sales_lines sl join sales_invoices si on si.id = sl.invoice_id join customers c on c.id = si.customer_id
              where sl.product_id = ${m.product_id} group by si.id, c.name
            union all
            select 'adjustment', a.id, a.reason, a.date::text, a.notes, (-a.qty)::int, a.created_at
              from stock_adjustments a where a.product_id = ${m.product_id} and a.qty < 0
          ) x order by date, created_at, id`,
    )
    const layers: Layer[] = [...(prod.opening_stock > 0 ? [{ purchaseId: null, qty: prod.opening_stock }] : []), ...ins.map((r) => ({ purchaseId: r.purchase_id, qty: r.qty }))]
    const usedBy = new Map<string, PurchaseUsageSale>()
    let li = 0
    for (const o of outs) {
      let need = o.qty
      while (need > 0 && li < layers.length) {
        const take = Math.min(need, layers[li].qty)
        if (take > 0 && layers[li].purchaseId === purchaseId) {
          const key = `${o.kind}-${o.id}`
          const prev = usedBy.get(key)
          if (prev) prev.qty += take
          else usedBy.set(key, { kind: o.kind, id: o.id, ref: o.ref, date: o.date, party: o.party ?? '', qty: take })
        }
        layers[li].qty -= take
        need -= take
        if (layers[li].qty <= 0) li++
      }
    }
    const list = [...usedBy.values()]
    items.push({ productId: m.product_id, label: m.label, received: m.qty, used: list.reduce((a, b) => a + b.qty, 0), usedBy: list })
  }
  return { purchaseId, invoiceNo: inv.invoice_no, used: items.some((i) => i.used > 0), items }
}

/** One readable sentence for the "can't delete" notice. */
export function usageMessage(u: PurchaseUsage, action: 'delete' | 'reduce') {
  const used = u.items.filter((i) => i.used > 0)
  const parts = used.map((i) => {
    const sales = i.usedBy.filter((s) => s.kind === 'sale').map((s) => s.ref)
    const adj = i.usedBy.filter((s) => s.kind === 'adjustment').length
    return `${i.label} (${i.used} of ${i.received} used — ${[...sales, ...(adj ? [`${adj} stock adjustment${adj > 1 ? 's' : ''}`] : [])].join(', ')})`
  })
  const verb = action === 'delete' ? `delete ${u.invoiceNo}` : `reduce these items on ${u.invoiceNo}`
  return `Cannot ${verb} — items from it are already on sales invoices: ${parts.join('; ')}. Delete or edit those sales first.`
}
