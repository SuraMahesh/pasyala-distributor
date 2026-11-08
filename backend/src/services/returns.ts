// Sales returns (credit notes): goods a customer sends back.
//  - stock: the units go back on the shelf (restock) or are written off (damaged / expired — stock unchanged)
//  - money: the net total comes off the customer's balance, against the invoice named on the return (else FIFO);
//    cash handed back is recorded as `refunded` and does not reduce the balance
//  - a return that names an invoice can never take back more than that invoice sold, and that invoice cannot be
//    deleted (or edited below the returned qty) while the return exists
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { invoiceTotals, lineNet, rs, round2, type InvoiceLine, type SalesReturn, type SalesReturnInput, type SalesReturnRef } from '@pjd/shared'
import type { DB, Executor, Tx } from '../db/client'
import { customers, customerTypes, products, salesInvoices, salesLines, salesReturnLines, salesReturns, settings } from '../db/schema'
import { badRequest, notFound } from '../errors'
import { customerDues } from './dues'
import type { SaveResult } from './invoices'
import { assertStockAvailable, mergeDeltas, stockMap, unitsByProduct } from './stock'

/** Units (qty + free) already taken back per product on returns that name this invoice. */
export async function returnedOnInvoice(ex: Executor, saleId: number, exceptReturnId?: number) {
  const list = await ex
    .select({ productId: salesReturnLines.productId, units: sql<number>`sum(${salesReturnLines.qty} + ${salesReturnLines.freeQty})::int` })
    .from(salesReturnLines)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.returnId))
    .where(exceptReturnId ? and(eq(salesReturns.salesInvoiceId, saleId), ne(salesReturns.id, exceptReturnId)) : eq(salesReturns.salesInvoiceId, saleId))
    .groupBy(salesReturnLines.productId)
  return new Map(list.map((r) => [r.productId, Number(r.units)]))
}

export async function returnsOfSale(ex: Executor, saleId: number): Promise<SalesReturnRef[]> {
  return ex
    .select({ id: salesReturns.id, returnNo: salesReturns.returnNo, date: salesReturns.date, netTotal: salesReturns.netTotal, restock: salesReturns.restock })
    .from(salesReturns)
    .where(eq(salesReturns.salesInvoiceId, saleId))
    .orderBy(asc(salesReturns.date), asc(salesReturns.id))
}

export const returnNoFor = (prefix: string, n: number) => `${prefix}R${String(n).padStart(6, '0')}`

async function nextReturnNo(tx: Tx) {
  const [s] = await tx.select().from(settings).where(eq(settings.id, 1)).for('update')
  if (!s) throw new Error('Settings row missing — run migrations/seed')
  let n = s.nextReturnNo
  for (;;) {
    const no = returnNoFor(s.invoicePrefix, n)
    const [hit] = await tx.select({ id: salesReturns.id }).from(salesReturns).where(eq(salesReturns.returnNo, no))
    if (!hit) {
      await tx.update(settings).set({ nextReturnNo: n + 1 }).where(eq(settings.id, 1))
      return no
    }
    n++
  }
}

export async function saveReturn(db: DB, input: SalesReturnInput, id?: number): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    const [existing] = id ? await tx.select().from(salesReturns).where(eq(salesReturns.id, id)).for('update') : []
    if (id && !existing) throw notFound('Sales return')

    const [cust] = await tx.select().from(customers).where(eq(customers.id, input.customerId))
    if (!cust) throw badRequest('Customer does not exist')

    // every item must exist (inactive is fine — goods can come back after an item was retired)
    const productIds = [...new Set(input.lines.map((l) => l.productId))]
    const found = await tx.select({ id: products.id, label: sql<string>`${products.size} || ' ' || ${products.name}` }).from(products).where(inArray(products.id, productIds))
    const label = new Map(found.map((p) => [p.id, p.label]))
    for (const pid of productIds) if (!label.has(pid)) throw badRequest(`Item #${pid} does not exist`)

    // a return against an invoice: only items sold on it, never more than were sold
    const unitCostByProduct = new Map<number, number>()
    if (input.salesInvoiceId != null) {
      const [inv] = await tx.select({ id: salesInvoices.id, invoiceNo: salesInvoices.invoiceNo, customerId: salesInvoices.customerId }).from(salesInvoices).where(eq(salesInvoices.id, input.salesInvoiceId))
      if (!inv) throw badRequest('That sales invoice does not exist')
      if (inv.customerId !== cust.id) {
        const [owner] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, inv.customerId))
        throw badRequest(`${inv.invoiceNo} was sold to ${owner?.name ?? 'another customer'}, not to ${cust.name}`)
      }
      const sold = await tx.select().from(salesLines).where(eq(salesLines.invoiceId, inv.id))
      const soldUnits = unitsByProduct(sold)
      for (const l of sold) if (!unitCostByProduct.has(l.productId)) unitCostByProduct.set(l.productId, l.unitCost)
      const already = await returnedOnInvoice(tx, inv.id, existing?.id)
      for (const [pid, units] of unitsByProduct(input.lines)) {
        const soldQty = soldUnits.get(pid) ?? 0
        if (!soldQty) throw badRequest(`${label.get(pid)} is not on ${inv.invoiceNo}`)
        const before = already.get(pid) ?? 0
        if (units + before > soldQty) {
          throw badRequest(`${label.get(pid)}: ${inv.invoiceNo} sold ${soldQty}${before ? ` and ${before} already came back` : ''} — cannot take back ${units}`)
        }
      }
    }

    const totals = invoiceTotals(input.lines, input.billDiscPct)
    if (input.refunded > totals.netTotal + 0.004) throw badRequest(`Refund (${rs(input.refunded)}) is more than the return total (${rs(totals.netTotal)})`)

    // stock: what this return put on the shelf before comes off again, what it puts there now goes on
    const oldLines = existing ? await tx.select().from(salesReturnLines).where(eq(salesReturnLines.returnId, existing.id)) : []
    const deltas = mergeDeltas(
      [existing?.restock ? unitsByProduct(oldLines) : new Map(), -1],
      [input.restock ? unitsByProduct(input.lines) : new Map(), 1],
    )
    await assertStockAvailable(tx, deltas, existing ? 'change this return' : undefined)

    // cost of the charged units coming back: as on the invoice they were sold on, else today's paid unit price; free units Rs 0
    const stock = await stockMap(tx, productIds)
    const lineRows = input.lines.map((l, i) => ({
      lineNo: i + 1,
      productId: l.productId,
      qty: l.qty,
      freeQty: l.freeQty,
      unitPrice: l.unitPrice,
      discPct: l.discPct,
      lineNet: lineNet(l),
      unitCost: unitCostByProduct.get(l.productId) ?? stock.get(l.productId)?.avgCost ?? 0,
    }))
    const header = {
      date: input.date,
      customerId: input.customerId,
      salesInvoiceId: input.salesInvoiceId,
      reason: input.reason,
      restock: input.restock,
      billDiscPct: input.billDiscPct,
      gross: totals.gross,
      lineDiscount: totals.lineDiscount,
      subTotal: totals.subTotal,
      billDiscount: totals.billDiscount,
      netTotal: totals.netTotal,
      costTotal: round2(lineRows.reduce((s, l) => s + l.unitCost * l.qty, 0)),
      refunded: input.refunded,
      refundMethod: input.refunded > 0 ? input.refundMethod : '',
      notes: input.notes,
      updatedAt: new Date(),
    }

    let returnId: number
    let returnNo: string
    if (existing) {
      await tx.update(salesReturns).set(header).where(eq(salesReturns.id, existing.id))
      await tx.delete(salesReturnLines).where(eq(salesReturnLines.returnId, existing.id))
      returnId = existing.id
      returnNo = existing.returnNo
    } else {
      returnNo = await nextReturnNo(tx)
      const [row] = await tx.insert(salesReturns).values({ ...header, returnNo }).returning({ id: salesReturns.id })
      returnId = row.id
    }
    await tx.insert(salesReturnLines).values(lineRows.map((l) => ({ ...l, returnId })))

    const warnings: string[] = []
    const bal = (await customerDues(tx)).get(cust.id).balance
    if (bal < -0.004) warnings.push(`${cust.name} now has Rs ${rs(-bal)} credit with you — use it on the next invoice or refund it`)
    return { id: returnId, invoiceNo: returnNo, warnings }
  })
}

export async function deleteReturn(db: DB, id: number) {
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(salesReturns).where(eq(salesReturns.id, id)).for('update')
    if (!r) throw notFound('Sales return')
    if (r.restock) {
      const lines = await tx.select().from(salesReturnLines).where(eq(salesReturnLines.returnId, id))
      await assertStockAvailable(tx, mergeDeltas([unitsByProduct(lines), -1]), `delete ${r.returnNo}`)
    }
    await tx.delete(salesReturns).where(eq(salesReturns.id, id)) // lines cascade
  })
}

export async function getReturn(ex: Executor, id: number): Promise<SalesReturn> {
  const [h] = await ex
    .select({ r: salesReturns, customerName: customers.name, customerTypeName: customerTypes.name, invoiceNo: salesInvoices.invoiceNo })
    .from(salesReturns)
    .innerJoin(customers, eq(customers.id, salesReturns.customerId))
    .innerJoin(customerTypes, eq(customerTypes.id, customers.typeId))
    .leftJoin(salesInvoices, eq(salesInvoices.id, salesReturns.salesInvoiceId))
    .where(eq(salesReturns.id, id))
  if (!h) throw notFound('Sales return')
  const lines: InvoiceLine[] = await ex
    .select({
      id: salesReturnLines.id,
      productId: salesReturnLines.productId,
      qty: salesReturnLines.qty,
      freeQty: salesReturnLines.freeQty,
      unitPrice: salesReturnLines.unitPrice,
      discPct: salesReturnLines.discPct,
      lineNet: salesReturnLines.lineNet,
      unitCost: salesReturnLines.unitCost,
      code: products.code,
      name: products.name,
      size: products.size,
    })
    .from(salesReturnLines)
    .innerJoin(products, eq(products.id, salesReturnLines.productId))
    .where(eq(salesReturnLines.returnId, id))
    .orderBy(asc(salesReturnLines.lineNo))
  const { createdAt: _c, updatedAt: _u, ...r } = h.r
  return {
    ...r,
    reason: r.reason as SalesReturn['reason'],
    refundMethod: r.refundMethod as SalesReturn['refundMethod'],
    credited: round2(r.netTotal - r.refunded),
    customerName: h.customerName,
    customerTypeName: h.customerTypeName,
    invoiceNo: h.invoiceNo ?? null,
    lines,
  }
}

/** Newest first — for the customer page and the invoice page. */
export const returnsOrder = [desc(salesReturns.date), desc(salesReturns.id)]
