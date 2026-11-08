// Re-costs every sales invoice (and the sales returns that copy an invoice's costs) with the costing rule:
// charged units at the paid unit price (list − supplier discounts, today's price), free items at Rs 0 on both
// sides — free issues received never dilute the unit price, free units given cost nothing.
// Preview by default; `apply` rewrites the saved unit costs and cost totals.
import { eq } from 'drizzle-orm'
import { round2 } from '@pjd/shared'
import type { DB } from '../db/client'
import { salesInvoices, salesLines, salesReturnLines, salesReturns } from '../db/schema'
import { stockMap } from './stock'

export interface RecostRow {
  id: number
  invoiceNo: string
  date: string
  oldCost: number
  newCost: number
}
export interface RecostReport {
  apply: boolean
  invoices: number
  changed: number
  oldCost: number
  newCost: number
  returns: number
  returnsChanged: number
  rows: RecostRow[]
}

export async function recostSales(db: DB, apply: boolean): Promise<RecostReport> {
  const stock = await stockMap(db)
  const price = (productId: number) => stock.get(productId)?.avgCost ?? 0

  // sales lines: unit cost = paid unit price, cost = charged qty × unit cost
  const invoices = await db.select({ id: salesInvoices.id, invoiceNo: salesInvoices.invoiceNo, date: salesInvoices.date, costTotal: salesInvoices.costTotal }).from(salesInvoices)
  const lines = await db.select({ id: salesLines.id, invoiceId: salesLines.invoiceId, productId: salesLines.productId, qty: salesLines.qty, unitCost: salesLines.unitCost }).from(salesLines)
  const newLineCost = new Map<number, number>() // sales line id → unit cost
  const byInvoice = new Map<number, number>() // invoice id → new cost total
  const lineCostByInvoiceProduct = new Map<string, number>() // `${invoiceId}:${productId}` → unit cost (for linked returns)
  for (const l of lines) {
    const unitCost = price(l.productId)
    newLineCost.set(l.id, unitCost)
    byInvoice.set(l.invoiceId, round2((byInvoice.get(l.invoiceId) ?? 0) + round2(l.qty * unitCost)))
    const key = `${l.invoiceId}:${l.productId}`
    if (!lineCostByInvoiceProduct.has(key)) lineCostByInvoiceProduct.set(key, unitCost)
  }
  const report: RecostReport = { apply, invoices: invoices.length, changed: 0, oldCost: 0, newCost: 0, returns: 0, returnsChanged: 0, rows: [] }
  for (const inv of invoices) {
    const newCost = byInvoice.get(inv.id) ?? 0
    report.oldCost = round2(report.oldCost + inv.costTotal)
    report.newCost = round2(report.newCost + newCost)
    if (Math.abs(newCost - inv.costTotal) > 0.005) {
      report.changed++
      report.rows.push({ id: inv.id, invoiceNo: inv.invoiceNo, date: inv.date, oldCost: inv.costTotal, newCost })
    }
  }
  report.rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)

  // return lines: the cost of the invoice line they came from (else today's paid unit price); free units Rs 0
  const returnLines = await db
    .select({ id: salesReturnLines.id, returnId: salesReturnLines.returnId, productId: salesReturnLines.productId, qty: salesReturnLines.qty, unitCost: salesReturnLines.unitCost, salesInvoiceId: salesReturns.salesInvoiceId })
    .from(salesReturnLines)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.returnId))
  const newReturnLine = new Map<number, number>()
  const returnTotals = new Map<number, number>()
  for (const l of returnLines) {
    const unit = (l.salesInvoiceId != null ? lineCostByInvoiceProduct.get(`${l.salesInvoiceId}:${l.productId}`) : undefined) ?? price(l.productId)
    newReturnLine.set(l.id, unit)
    if (Math.abs(unit - l.unitCost) > 0.00005) report.returnsChanged++
    returnTotals.set(l.returnId, round2((returnTotals.get(l.returnId) ?? 0) + unit * l.qty))
  }
  report.returns = returnTotals.size

  if (apply) {
    await db.transaction(async (tx) => {
      for (const l of lines) {
        const c = newLineCost.get(l.id)
        if (c != null && Math.abs(c - l.unitCost) > 0.00005) await tx.update(salesLines).set({ unitCost: c }).where(eq(salesLines.id, l.id))
      }
      for (const r of report.rows) await tx.update(salesInvoices).set({ costTotal: r.newCost }).where(eq(salesInvoices.id, r.id))
      for (const l of returnLines) {
        const unit = newReturnLine.get(l.id)
        if (unit != null && Math.abs(unit - l.unitCost) > 0.00005) await tx.update(salesReturnLines).set({ unitCost: unit }).where(eq(salesReturnLines.id, l.id))
      }
      for (const [id, total] of returnTotals) await tx.update(salesReturns).set({ costTotal: total }).where(eq(salesReturns.id, id))
    })
  }
  return report
}
