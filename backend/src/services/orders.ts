// Order requests (purchase orders) to the supplier: a list of items we want, printed and sent to Pasyale.
// Nothing here moves stock or money — the GRN does that when the goods arrive. A line is a catalogue item
// (productId, name and size copied from the product) or an item typed by hand that is not in the stock list yet.
import { asc, eq, inArray } from 'drizzle-orm'
import { round2, type OrderRequest, type OrderRequestInput, type OrderRequestLine, type OrderRequestStatus } from '@pjd/shared'
import type { DB, Executor, Tx } from '../db/client'
import { orderRequestLines, orderRequests, products, settings, suppliers } from '../db/schema'
import { badRequest, notFound } from '../errors'

export const orderNoFor = (prefix: string, n: number) => `${prefix}PO${String(n).padStart(6, '0')}`

async function nextOrderNo(tx: Tx) {
  const [s] = await tx.select().from(settings).where(eq(settings.id, 1)).for('update')
  if (!s) throw new Error('Settings row missing — run migrations/seed')
  let n = s.nextOrderNo
  for (;;) {
    const no = orderNoFor(s.invoicePrefix, n)
    const [hit] = await tx.select({ id: orderRequests.id }).from(orderRequests).where(eq(orderRequests.requestNo, no))
    if (!hit) {
      await tx.update(settings).set({ nextOrderNo: n + 1 }).where(eq(settings.id, 1))
      return no
    }
    n++
  }
}

export async function saveOrderRequest(db: DB, input: OrderRequestInput, id?: number): Promise<{ id: number; requestNo: string }> {
  return db.transaction(async (tx) => {
    let requestNo = ''
    if (id) {
      const [existing] = await tx.select({ requestNo: orderRequests.requestNo }).from(orderRequests).where(eq(orderRequests.id, id)).for('update')
      if (!existing) throw notFound('Order request')
      requestNo = existing.requestNo
    }
    const [sup] = await tx.select({ id: suppliers.id, active: suppliers.active }).from(suppliers).where(eq(suppliers.id, input.supplierId))
    if (!sup) throw badRequest('Choose a supplier')
    if (!sup.active) throw badRequest('That supplier is inactive')

    // catalogue lines take their name, size and (when no price was typed) the supplier's list price from the product
    const ids = [...new Set(input.lines.map((l) => l.productId).filter((x): x is number => x !== null))]
    const prods = ids.length ? await tx.select({ id: products.id, name: products.name, size: products.size, listPrice: products.listPrice }).from(products).where(inArray(products.id, ids)) : []
    const pmap = new Map(prods.map((p) => [p.id, p]))
    const rows = input.lines.map((l, i) => {
      const p = l.productId !== null ? pmap.get(l.productId) : undefined
      if (l.productId !== null && !p) throw badRequest(`Line ${i + 1}: item not found`)
      return {
        lineNo: i + 1,
        productId: p?.id ?? null,
        name: p ? p.name : l.name.trim(),
        size: p ? p.size : l.size,
        qty: l.qty,
        unitPrice: l.unitPrice ?? (p && p.listPrice > 0 ? p.listPrice : null),
        notes: l.notes,
      }
    })

    const header = { supplierId: input.supplierId, date: input.date, status: input.status, showPrices: input.showPrices, notes: input.notes, updatedAt: new Date() }
    if (id) {
      await tx.update(orderRequests).set(header).where(eq(orderRequests.id, id))
      await tx.delete(orderRequestLines).where(eq(orderRequestLines.requestId, id))
    } else {
      requestNo = await nextOrderNo(tx)
      const [r] = await tx.insert(orderRequests).values({ requestNo, ...header }).returning({ id: orderRequests.id })
      id = r.id
    }
    await tx.insert(orderRequestLines).values(rows.map((r) => ({ requestId: id!, ...r })))
    return { id: id!, requestNo }
  })
}

/** status and the show-prices switch can change without re-sending the lines */
export async function setOrderRequestFlags(db: DB, id: number, flags: { status?: OrderRequestStatus; showPrices?: boolean }): Promise<OrderRequest> {
  const [hit] = await db.update(orderRequests).set({ ...flags, updatedAt: new Date() }).where(eq(orderRequests.id, id)).returning({ id: orderRequests.id })
  if (!hit) throw notFound('Order request')
  return getOrderRequest(db, id)
}

export async function deleteOrderRequest(db: DB, id: number) {
  const [hit] = await db.delete(orderRequests).where(eq(orderRequests.id, id)).returning({ id: orderRequests.id })
  if (!hit) throw notFound('Order request')
}

export function summarise(lines: { qty: number; unitPrice: number | null }[]) {
  const priced = lines.filter((l) => l.unitPrice !== null)
  return {
    units: lines.reduce((s, l) => s + l.qty, 0),
    total: priced.length ? round2(priced.reduce((s, l) => s + l.qty * (l.unitPrice ?? 0), 0)) : null,
    unpriced: lines.length - priced.length,
  }
}

export async function orderRequestLinesFor(ex: Executor, requestId: number): Promise<OrderRequestLine[]> {
  const rows = await ex
    .select({
      id: orderRequestLines.id, lineNo: orderRequestLines.lineNo, productId: orderRequestLines.productId, name: orderRequestLines.name,
      size: orderRequestLines.size, qty: orderRequestLines.qty, unitPrice: orderRequestLines.unitPrice, notes: orderRequestLines.notes, code: products.code,
    })
    .from(orderRequestLines)
    .leftJoin(products, eq(products.id, orderRequestLines.productId))
    .where(eq(orderRequestLines.requestId, requestId))
    .orderBy(asc(orderRequestLines.lineNo))
  return rows.map((r) => ({ ...r, code: r.code ?? '' }))
}

export async function getOrderRequest(ex: Executor, id: number): Promise<OrderRequest> {
  const [h] = await ex
    .select({ req: orderRequests, supplierName: suppliers.name })
    .from(orderRequests)
    .innerJoin(suppliers, eq(suppliers.id, orderRequests.supplierId))
    .where(eq(orderRequests.id, id))
  if (!h) throw notFound('Order request')
  const lines = await orderRequestLinesFor(ex, id)
  const { createdAt: _c, updatedAt: _u, ...req } = h.req
  return { ...req, status: req.status as OrderRequestStatus, supplierName: h.supplierName, lines, ...summarise(lines) }
}
