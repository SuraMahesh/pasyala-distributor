import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import {
  invoiceTotals,
  landedUnitCost,
  lineNet,
  rs,
  round2,
  type InvoiceLine,
  type PurchaseInvoice,
  type PurchaseInvoiceInput,
  type SalesInvoice,
  type SalesInvoiceInput,
} from '@pjd/shared'
import type { DB, Executor, Tx } from '../db/client'
import {
  customers,
  customerTypes,
  products,
  purchaseInvoices,
  purchaseLines,
  salesInvoices,
  salesLines,
  settings,
  suppliers,
} from '../db/schema'
import { badRequest, conflict, notFound } from '../errors'
import { customerDues, supplierDues } from './dues'
import { returnedOnInvoice, returnsOfSale } from './returns'
import { assertStockAvailable, lockProducts, mergeDeltas, saleCosts, stockMap, unitsByProduct } from './stock'
import { purchaseUsage, usageMessage } from './usage'

export interface SaveResult {
  id: number
  invoiceNo: string
  warnings: string[]
}

async function checkProducts(tx: Tx, lines: { productId: number }[], allowInactive: Set<number>) {
  const ids = [...new Set(lines.map((l) => l.productId))]
  const found = await tx.select({ id: products.id, active: products.active, label: sql<string>`${products.size} || ' ' || ${products.name}` }).from(products).where(inArray(products.id, ids))
  const byId = new Map(found.map((p) => [p.id, p]))
  for (const id of ids) {
    const p = byId.get(id)
    if (!p) throw badRequest(`Item #${id} does not exist`)
    if (!p.active && !allowInactive.has(id)) throw badRequest(`${p.label} is inactive — activate it first`)
  }
  return byId
}

async function nextInvoiceNo(tx: Tx) {
  const [s] = await tx.select().from(settings).where(eq(settings.id, 1)).for('update')
  if (!s) throw new Error('Settings row missing — run migrations/seed')
  let n = s.nextInvoiceNo
  for (;;) {
    const no = s.invoicePrefix + String(n).padStart(6, '0')
    const [hit] = await tx.select({ id: salesInvoices.id }).from(salesInvoices).where(eq(salesInvoices.invoiceNo, no))
    if (!hit) {
      await tx.update(settings).set({ nextInvoiceNo: n + 1 }).where(eq(settings.id, 1))
      return no
    }
    n++
  }
}

// ------------------------------------------------------------------ SALES

export async function saveSale(db: DB, input: SalesInvoiceInput, id?: number): Promise<SaveResult> {
  const result = await db.transaction(async (tx) => {
    const [existing] = id ? await tx.select().from(salesInvoices).where(eq(salesInvoices.id, id)).for('update') : []
    if (id && !existing) throw notFound('Sales invoice')

    const [cust] = await tx.select().from(customers).where(eq(customers.id, input.customerId))
    if (!cust) throw badRequest('Customer does not exist')
    if (!cust.active && existing?.customerId !== cust.id) throw badRequest(`${cust.name} is inactive`)

    const oldLines = existing ? await tx.select().from(salesLines).where(eq(salesLines.invoiceId, existing.id)) : []
    await checkProducts(tx, input.lines, new Set(oldLines.map((l) => l.productId)))

    // goods already taken back on a sales return must stay on the invoice
    if (existing) {
      const returned = await returnedOnInvoice(tx, existing.id)
      const keep = unitsByProduct(input.lines)
      const short = [...returned].filter(([pid, units]) => (keep.get(pid) ?? 0) < units)
      if (short.length) {
        const [pid, units] = short[0]
        const [p] = await tx.select({ label: sql<string>`${products.size} || ' ' || ${products.name}` }).from(products).where(eq(products.id, pid))
        throw badRequest(`${p?.label ?? 'Item'}: ${units} already came back on a sales return, so ${existing.invoiceNo} must keep at least ${units}. Delete the return first.`)
      }
    }

    // stock leaving = new lines, stock coming back = old lines of this invoice
    await assertStockAvailable(tx, mergeDeltas([unitsByProduct(oldLines), 1], [unitsByProduct(input.lines), -1]))

    const totals = invoiceTotals(input.lines, input.billDiscPct)
    if (input.paidOnInvoice > totals.netTotal + 0.004) {
      throw badRequest(`Paid amount (${rs(input.paidOnInvoice)}) is more than the invoice total (${rs(totals.netTotal)})`)
    }
    const stock = await stockMap(tx, [...new Set([...input.lines, ...oldLines].map((l) => l.productId))])
    // charged units at the paid unit price; free items cost Rs 0 on both sides (see saleCosts)
    const costs = saleCosts(input.lines, stock)
    const lineRows = input.lines.map((l, i) => ({
      lineNo: i + 1,
      productId: l.productId,
      qty: l.qty,
      freeQty: l.freeQty,
      unitPrice: l.unitPrice,
      discPct: l.discPct,
      lineNet: lineNet(l),
      unitCost: costs[i].unitCost,
    }))
    const costTotal = round2(costs.reduce((s, c) => s + c.cost, 0))
    const header = {
      date: input.date,
      customerId: input.customerId,
      payMethod: input.payMethod,
      billDiscPct: input.billDiscPct,
      paidOnInvoice: input.paidOnInvoice,
      chequeNo: input.payMethod === 'Cheque' ? (input.chequeNo ?? '') : '',
      chequeDate: input.payMethod === 'Cheque' ? (input.chequeDate ?? null) : null,
      gross: totals.gross,
      lineDiscount: totals.lineDiscount,
      subTotal: totals.subTotal,
      billDiscount: totals.billDiscount,
      netTotal: totals.netTotal,
      costTotal,
      notes: input.notes,
      updatedAt: new Date(),
    }

    let invoiceId: number
    let invoiceNo: string
    if (existing) {
      await tx.update(salesInvoices).set(header).where(eq(salesInvoices.id, existing.id))
      await tx.delete(salesLines).where(eq(salesLines.invoiceId, existing.id))
      invoiceId = existing.id
      invoiceNo = existing.invoiceNo
    } else {
      invoiceNo = await nextInvoiceNo(tx)
      const [row] = await tx.insert(salesInvoices).values({ ...header, invoiceNo }).returning({ id: salesInvoices.id })
      invoiceId = row.id
    }
    await tx.insert(salesLines).values(lineRows.map((l) => ({ ...l, invoiceId })))

    // warnings (saved anyway)
    const warnings: string[] = []
    const billFactor = 1 - input.billDiscPct / 100
    for (const l of lineRows) {
      if (l.qty === 0) continue
      // price per charged unit vs the paid unit price — free units are outside the margin maths
      const netUnit = (l.lineNet * billFactor) / l.qty
      if (netUnit + 0.005 < l.unitCost) {
        const s = stock.get(l.productId)
        warnings.push(`${s?.label ?? 'Item'} sold below cost (Rs ${rs(netUnit)} vs cost Rs ${rs(l.unitCost)})`)
      }
    }
    if (cust.creditLimit > 0) {
      const bal = (await customerDues(tx)).get(cust.id).balance
      if (bal > cust.creditLimit) warnings.push(`${cust.name} is over the credit limit: balance Rs ${rs(bal)}, limit Rs ${rs(cust.creditLimit)}`)
    }
    return { id: invoiceId, invoiceNo, warnings }
  })
  return result
}

/**
 * The cheque handed over with the invoice has been banked and cleared: the invoice is now paid on the invoice
 * itself (not a separate payment, which would go to the oldest open invoice first).
 */
export async function markChequeCleared(db: DB, kind: 'sale' | 'purchase', id: number) {
  const table = kind === 'sale' ? salesInvoices : purchaseInvoices
  return db.transaction(async (tx) => {
    const [inv] = await tx.select({ id: table.id, invoiceNo: table.invoiceNo, payMethod: table.payMethod, paidOnInvoice: table.paidOnInvoice, netTotal: table.netTotal }).from(table).where(eq(table.id, id)).for('update')
    if (!inv) throw notFound(kind === 'sale' ? 'Sales invoice' : 'Purchase invoice')
    if (inv.payMethod !== 'Cheque') throw badRequest(`${inv.invoiceNo} was not paid by cheque`)
    if (inv.paidOnInvoice + 0.004 >= inv.netTotal) throw badRequest(`${inv.invoiceNo} is already marked paid`)
    await tx.update(table).set({ paidOnInvoice: inv.netTotal, updatedAt: new Date() }).where(eq(table.id, id))
    return { id: inv.id, invoiceNo: inv.invoiceNo, paidOnInvoice: inv.netTotal }
  })
}

export async function deleteSale(db: DB, id: number) {
  await db.transaction(async (tx) => {
    const [inv] = await tx.select({ id: salesInvoices.id, invoiceNo: salesInvoices.invoiceNo }).from(salesInvoices).where(eq(salesInvoices.id, id)).for('update')
    if (!inv) throw notFound('Sales invoice')
    const returns = await returnsOfSale(tx, id)
    if (returns.length) throw conflict(`Cannot delete ${inv.invoiceNo} — sales return ${returns.map((r) => r.returnNo).join(', ')} was recorded against it. Delete the return first.`)
    await tx.delete(salesInvoices).where(eq(salesInvoices.id, id)) // lines cascade; stock returns automatically
  })
}

async function linesFor(ex: Executor, table: typeof salesLines | typeof purchaseLines, invoiceId: number): Promise<InvoiceLine[]> {
  return ex
    .select({
      id: table.id,
      productId: table.productId,
      qty: table.qty,
      freeQty: table.freeQty,
      unitPrice: table.unitPrice,
      discPct: table.discPct,
      lineNet: table.lineNet,
      unitCost: table.unitCost,
      code: products.code,
      name: products.name,
      size: products.size,
    })
    .from(table)
    .innerJoin(products, eq(products.id, table.productId))
    .where(eq(table.invoiceId, invoiceId))
    .orderBy(asc(table.lineNo))
}

export async function getSale(ex: Executor, id: number): Promise<SalesInvoice> {
  const [h] = await ex
    .select({ inv: salesInvoices, customerName: customers.name, customerTypeName: customerTypes.name })
    .from(salesInvoices)
    .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
    .innerJoin(customerTypes, eq(customerTypes.id, customers.typeId))
    .where(eq(salesInvoices.id, id))
  if (!h) throw notFound('Sales invoice')
  const due = (await customerDues(ex)).byInvoice.get(id)!
  const { createdAt: _c, updatedAt: _u, ...inv } = h.inv
  return {
    ...inv,
    payMethod: inv.payMethod as SalesInvoice['payMethod'],
    customerName: h.customerName,
    customerTypeName: h.customerTypeName,
    ...due,
    lines: await linesFor(ex, salesLines, id),
    returns: await returnsOfSale(ex, id),
  }
}

// ------------------------------------------------------------------ PURCHASES

export async function savePurchase(db: DB, input: PurchaseInvoiceInput, id?: number): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    const [existing] = id ? await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, id)).for('update') : []
    if (id && !existing) throw notFound('Purchase invoice')

    const [sup] = await tx.select().from(suppliers).where(eq(suppliers.id, input.supplierId))
    if (!sup) throw badRequest('Supplier does not exist')
    if (!sup.active && existing?.supplierId !== sup.id) throw badRequest(`${sup.name} is inactive`)

    const dupWhere = existing
      ? and(eq(purchaseInvoices.supplierId, input.supplierId), eq(purchaseInvoices.invoiceNo, input.invoiceNo), ne(purchaseInvoices.id, existing.id))
      : and(eq(purchaseInvoices.supplierId, input.supplierId), eq(purchaseInvoices.invoiceNo, input.invoiceNo))
    const [dup] = await tx.select({ id: purchaseInvoices.id }).from(purchaseInvoices).where(dupWhere)
    if (dup) throw conflict(`Invoice ${input.invoiceNo} from ${sup.name} is already entered`)

    const oldLines = existing ? await tx.select().from(purchaseLines).where(eq(purchaseLines.invoiceId, existing.id)) : []
    await checkProducts(tx, input.lines, new Set(oldLines.map((l) => l.productId)))
    if (existing) {
      // editing: a product may not go below what was already sold out of this invoice
      await lockProducts(tx, [...oldLines, ...input.lines].map((l) => l.productId))
      const usage = await purchaseUsage(tx, existing.id)
      const newQty = unitsByProduct(input.lines)
      const short = usage.items.filter((i) => i.used > (newQty.get(i.productId) ?? 0))
      if (short.length) throw conflict(usageMessage({ ...usage, items: short }, 'reduce'), { usage })
    }
    // removing/reducing a purchase takes stock away — make sure it was not already sold
    await assertStockAvailable(tx, mergeDeltas([unitsByProduct(input.lines), 1], [unitsByProduct(oldLines), -1]), existing ? 'reduce this purchase' : undefined)

    const totals = invoiceTotals(input.lines, input.billDiscPct)
    if (input.paidOnInvoice > totals.netTotal + 0.004) {
      throw badRequest(`Paid amount (${rs(input.paidOnInvoice)}) is more than the invoice total (${rs(totals.netTotal)})`)
    }
    const header = {
      invoiceNo: input.invoiceNo,
      supplierId: input.supplierId,
      orderNo: input.orderNo,
      salesPerson: input.salesPerson,
      date: input.date,
      payMethod: input.payMethod,
      billDiscPct: input.billDiscPct,
      paidOnInvoice: input.paidOnInvoice,
      chequeNo: input.payMethod === 'Cheque' ? (input.chequeNo ?? '') : '',
      chequeDate: input.payMethod === 'Cheque' ? (input.chequeDate ?? null) : null,
      gross: totals.gross,
      lineDiscount: totals.lineDiscount,
      subTotal: totals.subTotal,
      billDiscount: totals.billDiscount,
      netTotal: totals.netTotal,
      notes: input.notes,
      updatedAt: new Date(),
    }
    let invoiceId: number
    if (existing) {
      await tx.update(purchaseInvoices).set(header).where(eq(purchaseInvoices.id, existing.id))
      await tx.delete(purchaseLines).where(eq(purchaseLines.invoiceId, existing.id))
      invoiceId = existing.id
    } else {
      const [row] = await tx.insert(purchaseInvoices).values(header).returning({ id: purchaseInvoices.id })
      invoiceId = row.id
    }
    await tx.insert(purchaseLines).values(
      input.lines.map((l, i) => ({
        invoiceId,
        lineNo: i + 1,
        productId: l.productId,
        qty: l.qty,
        freeQty: l.freeQty,
        unitPrice: l.unitPrice,
        discPct: l.discPct,
        lineNet: lineNet(l),
        unitCost: Math.round(landedUnitCost(l, input.billDiscPct) * 10000) / 10000,
      })),
    )
    await rememberLatestPurchasePrices(tx, input.lines.map((l) => l.productId))
    return { id: invoiceId, invoiceNo: input.invoiceNo, warnings: [] }
  })
}

/** Product unit price + supplier discount follow the newest GRN, so the next refill starts from them. */
async function rememberLatestPurchasePrices(ex: Executor, productIds: number[]) {
  const ids = [...new Set(productIds)]
  if (!ids.length) return
  await ex.execute(sql`
    update products p set list_price = x.unit_price, supplier_disc_pct = x.disc_pct
    from (
      select distinct on (pl.product_id) pl.product_id, pl.unit_price, pl.disc_pct
      from purchase_lines pl join purchase_invoices pi on pi.id = pl.invoice_id
      where pl.product_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and pl.unit_price > 0
      order by pl.product_id, pi.date desc, pi.created_at desc, pi.id desc, pl.line_no desc
    ) x
    where p.id = x.product_id`)
}

export async function deletePurchase(db: DB, id: number) {
  await db.transaction(async (tx) => {
    const [inv] = await tx.select({ id: purchaseInvoices.id }).from(purchaseInvoices).where(eq(purchaseInvoices.id, id)).for('update')
    if (!inv) throw notFound('Purchase invoice')
    const old = await tx.select().from(purchaseLines).where(eq(purchaseLines.invoiceId, id))
    await lockProducts(tx, old.map((l) => l.productId))
    // any of its goods already sold → keep the invoice (the sales depend on it)
    const usage = await purchaseUsage(tx, id)
    if (usage.used) throw conflict(usageMessage(usage, 'delete'), { usage })
    await assertStockAvailable(tx, mergeDeltas([unitsByProduct(old), -1]), 'delete this purchase')
    await tx.delete(purchaseInvoices).where(eq(purchaseInvoices.id, id))
    await rememberLatestPurchasePrices(tx, old.map((l) => l.productId))
  })
}

export async function getPurchase(ex: Executor, id: number): Promise<PurchaseInvoice> {
  const [h] = await ex
    .select({ inv: purchaseInvoices, supplierName: suppliers.name })
    .from(purchaseInvoices)
    .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .where(eq(purchaseInvoices.id, id))
  if (!h) throw notFound('Purchase invoice')
  const due = (await supplierDues(ex)).byInvoice.get(id)!
  const { createdAt: _c, updatedAt: _u, ...inv } = h.inv
  return {
    ...inv,
    payMethod: inv.payMethod as PurchaseInvoice['payMethod'],
    supplierName: h.supplierName,
    ...due,
    lines: await linesFor(ex, purchaseLines, id),
  }
}
