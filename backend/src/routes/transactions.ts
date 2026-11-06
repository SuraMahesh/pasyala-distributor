import { Router } from 'express'
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import {
  adjustmentSchema,
  listQuerySchema,
  paymentSchema,
  purchaseInvoiceSchema,
  round2,
  salesInvoiceSchema,
  salesReturnSchema,
} from '@pjd/shared'
import type { DB } from '../db/client'
import {
  customers,
  customerTypes,
  payments,
  products,
  purchaseInvoices,
  salesInvoices,
  salesReturns,
  stockAdjustments,
  suppliers,
} from '../db/schema'
import { badRequest, idParam, notFound, parse } from '../errors'
import { paginate } from '../lib/list'
import { customerDues, supplierDues } from '../services/dues'
import { deletePurchase, deleteSale, getPurchase, getSale, markChequeCleared, savePurchase, saveSale } from '../services/invoices'
import { deleteReturn, getReturn, saveReturn } from '../services/returns'
import { assertStockAvailable } from '../services/stock'
import { purchaseUsage } from '../services/usage'
import { removeFiles } from '../services/files'
import { imagesOf } from './images'

const dateRange = {
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
}
const statusFilter = z.enum(['', 'paid', 'due', 'overdue', 'cheque']).default('') // cheque = paid by cheque, cheque not cleared yet
const imagesFilter = z.enum(['', 'has', 'none']).default('')
const byImages = <T extends { imageCount: number }>(items: T[], f: string) => (f === 'has' ? items.filter((i) => i.imageCount > 0) : f === 'none' ? items.filter((i) => i.imageCount === 0) : items)

const invoiceSorters = {
  invoiceNo: (i: { invoiceNo: string }) => i.invoiceNo,
  date: (i: { date: string; id: number }) => `${i.date}-${String(i.id).padStart(9, '0')}`,
  netTotal: (i: { netTotal: number }) => i.netTotal,
  due: (i: { due: number }) => i.due,
  party: (i: { partyName: string }) => i.partyName,
}

export function transactionRoutes(db: DB) {
  const r = Router()

  r.get('/purchases/:id/usage', async (req, res) => {
    res.json(await purchaseUsage(db, idParam(req.params.id)))
  })

  // ---------------- sales
  r.get('/sales', async (req, res) => {
    const q = listQuerySchema.extend({ ...dateRange, customerId: z.coerce.number().int().optional(), typeId: z.coerce.number().int().optional(), status: statusFilter, images: imagesFilter }).parse(req.query)
    const where: SQL[] = []
    if (q.from) where.push(gte(salesInvoices.date, q.from))
    if (q.to) where.push(lte(salesInvoices.date, q.to))
    if (q.customerId) where.push(eq(salesInvoices.customerId, q.customerId))
    if (q.typeId) where.push(eq(customers.typeId, q.typeId))
    const [list, dues] = await Promise.all([
      db
        .select({
          id: salesInvoices.id, invoiceNo: salesInvoices.invoiceNo, date: salesInvoices.date, payMethod: salesInvoices.payMethod,
          netTotal: salesInvoices.netTotal, costTotal: salesInvoices.costTotal, paidOnInvoice: salesInvoices.paidOnInvoice,
          chequeNo: salesInvoices.chequeNo, chequeDate: salesInvoices.chequeDate,
          customerId: salesInvoices.customerId, partyName: customers.name, area: customers.area, typeName: customerTypes.name,
          imageCount: sql<number>`(select count(*)::int from invoice_images ii where ii.sales_invoice_id = ${salesInvoices.id})`,
        })
        .from(salesInvoices)
        .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
        .innerJoin(customerTypes, eq(customerTypes.id, customers.typeId))
        .where(where.length ? and(...where) : undefined),
      customerDues(db),
    ])
    let items = list.map((i) => ({ ...i, ...dues.byInvoice.get(i.id)! }))
    if (q.status === 'paid') items = items.filter((i) => i.status === 'paid')
    if (q.status === 'due') items = items.filter((i) => i.status !== 'paid')
    if (q.status === 'overdue') items = items.filter((i) => i.overdue)
    if (q.status === 'cheque') items = items.filter((i) => i.payMethod === 'Cheque' && i.status !== 'paid')
    items = byImages(items, q.images)
    const { filtered, ...page } = paginate(items, q, {
      search: (i) => `${i.invoiceNo} ${i.partyName} ${i.area} ${i.typeName} ${i.chequeNo}`,
      sorters: invoiceSorters,
      defaultSort: { key: 'date', dir: 'desc' },
    })
    const sum = (f: (i: (typeof items)[number]) => number) => round2(filtered.reduce((s, i) => s + f(i), 0))
    res.json({ ...page, summary: { count: filtered.length, netTotal: sum((i) => i.netTotal), due: sum((i) => i.due), profit: sum((i) => i.netTotal - i.costTotal) } })
  })
  r.get('/sales/:id', async (req, res) => res.json(await getSale(db, idParam(req.params.id))))
  r.post('/sales', async (req, res) => res.status(201).json(await saveSale(db, parse(salesInvoiceSchema, req.body))))
  r.put('/sales/:id', async (req, res) => res.json(await saveSale(db, parse(salesInvoiceSchema, req.body), idParam(req.params.id))))
  /** the customer's cheque has cleared — the invoice is paid on the invoice itself */
  r.post('/sales/:id/cheque-cleared', async (req, res) => res.json(await markChequeCleared(db, 'sale', idParam(req.params.id))))
  r.delete('/sales/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const files = await imagesOf(db, 'sale', id)
    await deleteSale(db, id)
    await removeFiles(files) // photos go with the invoice
    res.json({ ok: true })
  })

  // ---------------- sales returns (credit notes)
  r.get('/sales-returns', async (req, res) => {
    const q = listQuerySchema.extend({ ...dateRange, customerId: z.coerce.number().int().optional(), salesInvoiceId: z.coerce.number().int().optional(), restock: z.enum(['', 'yes', 'no']).default('') }).parse(req.query)
    const where: SQL[] = []
    if (q.from) where.push(gte(salesReturns.date, q.from))
    if (q.to) where.push(lte(salesReturns.date, q.to))
    if (q.customerId) where.push(eq(salesReturns.customerId, q.customerId))
    if (q.salesInvoiceId) where.push(eq(salesReturns.salesInvoiceId, q.salesInvoiceId))
    if (q.restock) where.push(eq(salesReturns.restock, q.restock === 'yes'))
    const list = await db
      .select({
        id: salesReturns.id, returnNo: salesReturns.returnNo, date: salesReturns.date, customerId: salesReturns.customerId, partyName: customers.name, typeName: customerTypes.name,
        salesInvoiceId: salesReturns.salesInvoiceId, invoiceNo: salesInvoices.invoiceNo, reason: salesReturns.reason, restock: salesReturns.restock,
        netTotal: salesReturns.netTotal, costTotal: salesReturns.costTotal, refunded: salesReturns.refunded, refundMethod: salesReturns.refundMethod,
        lineCount: sql<number>`(select count(*)::int from sales_return_lines rl where rl.return_id = ${salesReturns.id})`,
        units: sql<number>`(select coalesce(sum(qty + free_qty), 0)::int from sales_return_lines rl where rl.return_id = ${salesReturns.id})`,
      })
      .from(salesReturns)
      .innerJoin(customers, eq(customers.id, salesReturns.customerId))
      .innerJoin(customerTypes, eq(customerTypes.id, customers.typeId))
      .leftJoin(salesInvoices, eq(salesInvoices.id, salesReturns.salesInvoiceId))
      .where(where.length ? and(...where) : undefined)
    const items = list.map((i) => ({ ...i, credited: round2(i.netTotal - i.refunded) }))
    const { filtered, ...page } = paginate(items, q, {
      search: (i) => `${i.returnNo} ${i.partyName} ${i.invoiceNo ?? ''} ${i.reason} ${i.typeName}`,
      sorters: { returnNo: (i) => i.returnNo, date: (i) => `${i.date}-${String(i.id).padStart(9, '0')}`, netTotal: (i) => i.netTotal, credited: (i) => i.credited, party: (i) => i.partyName },
      defaultSort: { key: 'date', dir: 'desc' },
    })
    const sum = (f: (i: (typeof items)[number]) => number) => round2(filtered.reduce((s, i) => s + f(i), 0))
    res.json({ ...page, summary: { count: filtered.length, netTotal: sum((i) => i.netTotal), refunded: sum((i) => i.refunded), credited: sum((i) => i.credited), units: filtered.reduce((s, i) => s + i.units, 0) } })
  })
  r.get('/sales-returns/:id', async (req, res) => res.json(await getReturn(db, idParam(req.params.id))))
  r.post('/sales-returns', async (req, res) => res.status(201).json(await saveReturn(db, parse(salesReturnSchema, req.body))))
  r.put('/sales-returns/:id', async (req, res) => res.json(await saveReturn(db, parse(salesReturnSchema, req.body), idParam(req.params.id))))
  r.delete('/sales-returns/:id', async (req, res) => {
    await deleteReturn(db, idParam(req.params.id))
    res.json({ ok: true })
  })

  // ---------------- purchases
  r.get('/purchases', async (req, res) => {
    const q = listQuerySchema.extend({ ...dateRange, supplierId: z.coerce.number().int().optional(), status: statusFilter, images: imagesFilter }).parse(req.query)
    const where: SQL[] = []
    if (q.from) where.push(gte(purchaseInvoices.date, q.from))
    if (q.to) where.push(lte(purchaseInvoices.date, q.to))
    if (q.supplierId) where.push(eq(purchaseInvoices.supplierId, q.supplierId))
    const [list, dues] = await Promise.all([
      db
        .select({
          id: purchaseInvoices.id, invoiceNo: purchaseInvoices.invoiceNo, orderNo: purchaseInvoices.orderNo, date: purchaseInvoices.date,
          payMethod: purchaseInvoices.payMethod, netTotal: purchaseInvoices.netTotal, paidOnInvoice: purchaseInvoices.paidOnInvoice,
          chequeNo: purchaseInvoices.chequeNo, chequeDate: purchaseInvoices.chequeDate,
          subTotal: purchaseInvoices.subTotal, billDiscPct: purchaseInvoices.billDiscPct, billDiscount: purchaseInvoices.billDiscount,
          supplierId: purchaseInvoices.supplierId, partyName: suppliers.name,
          lineCount: sql<number>`(select count(*)::int from purchase_lines pl where pl.invoice_id = ${purchaseInvoices.id})`,
          units: sql<number>`(select coalesce(sum(qty), 0)::int from purchase_lines pl where pl.invoice_id = ${purchaseInvoices.id})`,
          freeUnits: sql<number>`(select coalesce(sum(free_qty), 0)::int from purchase_lines pl where pl.invoice_id = ${purchaseInvoices.id})`,
          imageCount: sql<number>`(select count(*)::int from invoice_images ii where ii.purchase_invoice_id = ${purchaseInvoices.id})`,
        })
        .from(purchaseInvoices)
        .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
        .where(where.length ? and(...where) : undefined),
      supplierDues(db),
    ])
    let items = list.map((i) => ({ ...i, ...dues.byInvoice.get(i.id)! }))
    if (q.status === 'paid') items = items.filter((i) => i.status === 'paid')
    if (q.status === 'due') items = items.filter((i) => i.status !== 'paid')
    if (q.status === 'overdue') items = items.filter((i) => i.overdue)
    if (q.status === 'cheque') items = items.filter((i) => i.payMethod === 'Cheque' && i.status !== 'paid')
    items = byImages(items, q.images)
    const { filtered, ...page } = paginate(items, q, {
      search: (i) => `${i.invoiceNo} ${i.orderNo} ${i.partyName} ${i.chequeNo}`,
      sorters: { ...invoiceSorters, billDiscount: (i: { billDiscount: number }) => i.billDiscount },
      defaultSort: { key: 'date', dir: 'desc' },
    })
    res.json({
      ...page,
      summary: {
        count: filtered.length,
        subTotal: round2(filtered.reduce((s, i) => s + i.subTotal, 0)),
        billDiscount: round2(filtered.reduce((s, i) => s + i.billDiscount, 0)),
        netTotal: round2(filtered.reduce((s, i) => s + i.netTotal, 0)),
        due: round2(filtered.reduce((s, i) => s + i.due, 0)),
      },
    })
  })
  r.get('/purchases/:id', async (req, res) => res.json(await getPurchase(db, idParam(req.params.id))))
  r.post('/purchases', async (req, res) => res.status(201).json(await savePurchase(db, parse(purchaseInvoiceSchema, req.body))))
  r.put('/purchases/:id', async (req, res) => res.json(await savePurchase(db, parse(purchaseInvoiceSchema, req.body), idParam(req.params.id))))
  r.post('/purchases/:id/cheque-cleared', async (req, res) => res.json(await markChequeCleared(db, 'purchase', idParam(req.params.id))))
  r.delete('/purchases/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const files = await imagesOf(db, 'purchase', id)
    await deletePurchase(db, id)
    await removeFiles(files) // photos go with the invoice
    res.json({ ok: true })
  })

  // ---------------- payments
  r.get('/payments', async (req, res) => {
    const q = listQuerySchema.extend({ ...dateRange, partyType: z.enum(['', 'customer', 'supplier']).default(''), method: z.string().default('') }).parse(req.query)
    const where: SQL[] = []
    if (q.from) where.push(gte(payments.date, q.from))
    if (q.to) where.push(lte(payments.date, q.to))
    if (q.partyType) where.push(eq(payments.partyType, q.partyType))
    if (q.method) where.push(eq(payments.method, q.method))
    const list = await db
      .select({
        id: payments.id, date: payments.date, partyType: payments.partyType, amount: payments.amount, method: payments.method,
        reference: payments.reference, notes: payments.notes, createdAt: payments.createdAt,
        partyId: sql<number>`coalesce(${payments.customerId}, ${payments.supplierId})`,
        partyName: sql<string>`coalesce(${customers.name}, ${suppliers.name})`,
      })
      .from(payments)
      .leftJoin(customers, eq(customers.id, payments.customerId))
      .leftJoin(suppliers, eq(suppliers.id, payments.supplierId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(payments.date), desc(payments.id))
    const { filtered, ...page } = paginate(list, q, {
      search: (p) => `${p.partyName} ${p.reference} ${p.notes} ${p.method}`,
      sorters: { date: (p) => `${p.date}-${String(p.id).padStart(9, '0')}`, amount: (p) => p.amount, party: (p) => p.partyName },
      defaultSort: { key: 'date', dir: 'desc' },
    })
    const sum = (t: string) => round2(filtered.filter((p) => p.partyType === t).reduce((s, p) => s + p.amount, 0))
    res.json({ ...page, summary: { received: sum('customer'), paidOut: sum('supplier') } })
  })
  r.post('/payments', async (req, res) => {
    const input = parse(paymentSchema, req.body)
    const isCustomer = input.partyType === 'customer'
    const table = isCustomer ? customers : suppliers
    const [party] = await db.select({ id: table.id }).from(table).where(eq(table.id, input.partyId))
    if (!party) throw badRequest(`${isCustomer ? 'Customer' : 'Supplier'} does not exist`)
    const [row] = await db
      .insert(payments)
      .values({
        date: input.date, partyType: input.partyType, amount: input.amount, method: input.method, reference: input.reference, notes: input.notes,
        customerId: isCustomer ? input.partyId : null, supplierId: isCustomer ? null : input.partyId,
      })
      .returning()
    res.status(201).json(row)
  })
  r.delete('/payments/:id', async (req, res) => {
    const del = await db.delete(payments).where(eq(payments.id, idParam(req.params.id))).returning({ id: payments.id })
    if (!del.length) throw notFound('Payment')
    res.json({ ok: true })
  })

  // ---------------- stock adjustments
  r.get('/adjustments', async (req, res) => {
    const q = listQuerySchema.extend({ ...dateRange, productId: z.coerce.number().int().optional() }).parse(req.query)
    const where: SQL[] = []
    if (q.from) where.push(gte(stockAdjustments.date, q.from))
    if (q.to) where.push(lte(stockAdjustments.date, q.to))
    if (q.productId) where.push(eq(stockAdjustments.productId, q.productId))
    const list = await db
      .select({
        id: stockAdjustments.id, date: stockAdjustments.date, productId: stockAdjustments.productId, qty: stockAdjustments.qty,
        reason: stockAdjustments.reason, notes: stockAdjustments.notes,
        productLabel: sql<string>`${products.size} || ' ' || ${products.name}`, productCode: products.code,
      })
      .from(stockAdjustments)
      .innerJoin(products, eq(products.id, stockAdjustments.productId))
      .where(where.length ? and(...where) : undefined)
    const { filtered: _f, ...page } = paginate(list, q, {
      search: (a) => `${a.productLabel} ${a.productCode} ${a.reason} ${a.notes}`,
      sorters: { date: (a) => `${a.date}-${String(a.id).padStart(9, '0')}`, qty: (a) => a.qty, product: (a) => a.productLabel },
      defaultSort: { key: 'date', dir: 'desc' },
    })
    res.json(page)
  })
  r.post('/adjustments', async (req, res) => {
    const input = parse(adjustmentSchema, req.body)
    const row = await db.transaction(async (tx) => {
      const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.id, input.productId))
      if (!p) throw badRequest('Item does not exist')
      await assertStockAvailable(tx, new Map([[input.productId, input.qty]]))
      const [created] = await tx.insert(stockAdjustments).values(input).returning()
      return created
    })
    res.status(201).json(row)
  })
  r.delete('/adjustments/:id', async (req, res) => {
    const id = idParam(req.params.id)
    await db.transaction(async (tx) => {
      const [a] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).for('update')
      if (!a) throw notFound('Adjustment')
      await assertStockAvailable(tx, new Map([[a.productId, -a.qty]]), 'remove this adjustment')
      await tx.delete(stockAdjustments).where(eq(stockAdjustments.id, id))
    })
    res.json({ ok: true })
  })

  return r
}
