/**
 * Bulk entry of sales invoices written by hand on the supplier's bill book — the same as typing them on
 * Sales → New: the ERP gives each its own PJD number, checks stock, and records the customer's due.
 *
 * Input: a JSON file (see src/db/imports/sales-2026-10.json). Customers are matched by code, else by a
 * similar name, else created. Products must already exist (matched by code, else by size + name). Every
 * invoice must reproduce the totals written on the bill or nothing is written.
 *
 * A bill can carry a `return`: the "RTN" lines the shop handed back on the same visit, deducted from what it
 * paid. They go in as a sales return of the same date (stock back on the shelf, the credit off the shop's
 * balance), so a later bill in the file can sell what an earlier one took back.
 *
 * Dry run unless `apply` is true. Safe to run again: bills and returns already entered (by their bill number in
 * the notes, or the same customer + date + net total) are skipped.
 */
import path from 'node:path'
import { and, eq, ilike, sql } from 'drizzle-orm'
import { customerSchema, invoiceTotals, normaliseSize, RETURN_REASONS, rs, type LineInput, type PayMethod, type ReturnReason, type SalesReturnInput } from '@pjd/shared'
import type { DB } from '../db/client'
import { customers, customerTypes, products, salesInvoices, salesReturns } from '../db/schema'
import { chooseUploader, photoCount, type ApiTarget } from './import-photos'
import { saveSale } from './invoices'
import { saveReturn } from './returns'
import { rows, stockMap } from './stock'

export interface SalesImportCustomer {
  code: string
  name: string
  /** SHOP, MEDICAL, PHARMACY, WALKIN … (Prices & discounts → Customer types) */
  typeCode: string
  phone?: string
  address?: string
  area?: string
  /** the customer's own discount %, used as the default on future invoices */
  discPct?: number | null
  creditLimit?: number
  creditDays?: number | null
  notes?: string
}

export interface SalesImportLine {
  /** ERP item code */
  code: string
  size: string
  name: string
  /** what is written on the bill (report only) */
  written?: string
  qty: number
  free?: number
  price: number
  discPct?: number
}

/** Goods the shop handed back on the same visit — the "RTN" lines on the paper, deducted from what it paid. */
export interface SalesImportReturn {
  /** why they came back (Sales → Returns reasons); default 'Unsold stock' */
  reason?: ReturnReason
  /** back on the shelf (default) or written off (damaged / expired) */
  restock?: boolean
  /** discount on the credit — defaults to the bill's own % */
  billDiscPct?: number
  /** totals written for the return on the bill — the lines must reproduce them */
  written?: { gross?: number; netTotal?: number }
  /** kept in the return's notes after the bill number */
  note?: string
  lines: SalesImportLine[]
}

export interface SalesImportInvoice {
  /** the number printed on the paper bill — kept in the invoice notes */
  billNo: string
  date: string
  /** code or name from `customers` */
  customer: string
  payMethod?: PayMethod
  billDiscPct: number
  /** amount paid when the bill was handed over; 'full' = the net total */
  paid?: number | 'full'
  /** cheque details when payMethod is Cheque; a cheque not paid yet (paid 0) falls due on chequeDate */
  chequeNo?: string
  chequeDate?: string
  /** totals written on the bill — the lines must reproduce them (the net may be rounded to the rupee by hand) */
  written?: { gross?: number; netTotal?: number }
  /** kept in the invoice notes after the bill number */
  note?: string
  photos?: string[]
  lines: SalesImportLine[]
  /** the goods handed back on this bill → a sales return of the same date */
  return?: SalesImportReturn
}

export interface SalesImportFile {
  customers: SalesImportCustomer[]
  payMethod?: PayMethod
  invoices: SalesImportInvoice[]
}

export interface CustomerReport {
  code: string
  name: string
  typeCode: string
  status: 'existing' | 'matched by name' | 'new'
  id?: number
  existingName?: string
  existingCode?: string
}

export interface SaleReport {
  billNo: string
  date: string
  customer: string
  status: 'new' | 'already entered' | 'skipped'
  id?: number
  invoiceNo?: string
  lines: number
  units: number
  freeUnits: number
  gross: number
  subTotal: number
  billDiscount: number
  netTotal: number
  paidOnInvoice: number
  photos: string[]
  photosAttached: number
  why?: string
}

export interface ReturnReport {
  billNo: string
  date: string
  customer: string
  status: 'new' | 'already entered' | 'skipped'
  id?: number
  returnNo?: string
  lines: number
  units: number
  freeUnits: number
  gross: number
  billDiscount: number
  /** the credit that comes off the shop's balance */
  netTotal: number
  restock: boolean
  why?: string
}

export interface SalesImportReport {
  apply: boolean
  customers: CustomerReport[]
  invoices: SaleReport[]
  /** the "RTN" goods on the bills, entered as sales returns */
  returns: ReturnReport[]
  /** per product: stock leaving with the new invoices (`units`) and coming back with the new returns (`back`), against what is on hand now */
  stock: { code: string; size: string; name: string; onHand: number; units: number; back: number; after: number }[]
  warnings: string[]
}

export interface SalesImportOptions {
  apply?: boolean
  photosDir?: string
  api?: ApiTarget
}

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ')
const key = (size: string, name: string) => `${normaliseSize(size)}|${norm(name)}`
const letters = (s: string) => norm(s).replace(/[^A-Z0-9]/g, '')
const billTag = (billNo: string) => `Bill No ${billNo.trim()}`

function levenshtein(a: string, b: string) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1))
      last = tmp
    }
  }
  return prev[b.length]
}

const similar = (a: string, b: string, slack = 2) => {
  const x = letters(a)
  const y = letters(b)
  return x === y || x.includes(y) || y.includes(x) || levenshtein(x, y) <= slack
}

type Resolved = { at: number; inv: SalesImportInvoice; row: SaleReport; customerKey: string; lines: LineInput[] }
type ResolvedReturn = { at: number; row: ReturnReport; customerKey: string; input: Omit<SalesReturnInput, 'customerId'> }

export async function importSales(db: DB, file: SalesImportFile, opts: SalesImportOptions = {}): Promise<SalesImportReport> {
  const apply = !!opts.apply
  if (!file.invoices?.length) throw new Error('The file has no invoices')

  const types = await db.select().from(customerTypes)
  const existingCustomers = await db.select().from(customers)
  const allProducts = await db.select().from(products)
  const productByCode = new Map(allProducts.map((p) => [p.code.toUpperCase(), p]))
  const productByKey = new Map(allProducts.map((p) => [key(p.size, p.name), p]))

  const report: SalesImportReport = { apply, customers: [], invoices: [], returns: [], stock: [], warnings: [] }

  // ---- customers
  const customerByRef = new Map<string, CustomerReport>() // code and name → report row
  for (const c of file.customers ?? []) {
    const code = c.code.trim().toUpperCase()
    const type = types.find((t) => t.code === c.typeCode.trim().toUpperCase())
    if (!type) throw new Error(`Customer ${c.name}: customer type ${c.typeCode} does not exist (${types.map((t) => t.code).join(', ')})`)
    const row: CustomerReport = { code, name: c.name.trim(), typeCode: type.code, status: 'new' }
    const byCode = existingCustomers.find((x) => x.code.toUpperCase() === code)
    if (byCode) {
      if (!similar(byCode.name, c.name, 4)) throw new Error(`Customer code ${code} is "${byCode.name}" in the ERP, not "${c.name}" — use another code (nothing written)`)
      row.status = 'existing'
      row.id = byCode.id
      row.existingName = byCode.name
      row.existingCode = byCode.code
    } else {
      const byName = existingCustomers.find((x) => similar(x.name, c.name, 3))
      if (byName) {
        row.status = 'matched by name'
        row.id = byName.id
        row.existingName = byName.name
        row.existingCode = byName.code
      }
    }
    report.customers.push(row)
    customerByRef.set(code, row)
    customerByRef.set(norm(c.name), row)
  }

  // ---- invoices
  const resolved: Resolved[] = []
  const resolvedReturns: ResolvedReturn[] = []
  const leaving = new Map<number, number>()
  const back = new Map<number, number>()
  const stock = await stockMap(db)
  const remaining = new Map([...stock].map(([id, s]) => [id, s.onHand]))
  const [settingsRow] = await rows<{ allow_negative_stock: boolean }>(db, sql`select allow_negative_stock from settings where id = 1`)
  const negativeOk = !!settingsRow?.allow_negative_stock

  /** file lines → ERP lines (products by code, else by size + name); unknown products are listed, not fatal */
  const resolveLines = (tag: string, src: SalesImportLine[]) => {
    const lines: LineInput[] = []
    const missing: string[] = []
    for (const l of src) {
      const code = l.code.trim().toUpperCase()
      const free = l.free ?? 0
      if (!Number.isInteger(l.qty) || l.qty < 0 || !Number.isInteger(free) || free < 0 || l.qty + free === 0) {
        throw new Error(`${tag}: ${l.size} ${l.name}: qty/free must be whole numbers and not both 0`)
      }
      if (!(l.price >= 0)) throw new Error(`${tag}: ${l.size} ${l.name}: bad price`)
      let p = productByCode.get(code)
      if (p && (normaliseSize(p.size) !== normaliseSize(l.size) || !similar(p.name, l.name))) {
        throw new Error(`${tag}: code ${code} is "${p.size} ${p.name}" in the ERP but the file says "${l.size} ${l.name}" (nothing written)`)
      }
      if (!p) p = productByKey.get(key(l.size, l.name))
      if (!p) {
        missing.push(`${code} ${l.size} ${l.name}`)
        continue
      }
      lines.push({ productId: p.id, qty: l.qty, freeQty: free, unitPrice: l.price, discPct: l.discPct ?? 0 })
    }
    return { lines, missing }
  }
  /** the totals are checked on the full transcription, so a wrong line is caught even when a product is missing */
  const checkWritten = (tag: string, src: SalesImportLine[], billDiscPct: number, w?: { gross?: number; netTotal?: number }) => {
    const totals = invoiceTotals(src.map((l) => ({ productId: 0, qty: l.qty, freeQty: l.free ?? 0, unitPrice: l.price, discPct: l.discPct ?? 0 })), billDiscPct)
    if (w?.gross != null && Math.abs(w.gross - totals.gross) > 0.004) {
      throw new Error(`${tag}: the lines add up to ${rs(totals.gross)} but the bill says ${rs(w.gross)} — fix the transcription first (nothing written)`)
    }
    if (w?.netTotal != null && Math.abs(w.netTotal - totals.netTotal) > 0.004) {
      if (Math.abs(w.netTotal - totals.netTotal) <= 1) {
        report.warnings.push(`${tag.replace(/^Bill/, 'bill')}: the bill rounds the net to ${rs(w.netTotal)}; the ERP keeps ${rs(totals.netTotal)}`)
      } else {
        throw new Error(`${tag}: net total ${rs(totals.netTotal)} does not match the bill's ${rs(w.netTotal)} — check the discount % (nothing written)`)
      }
    }
    return totals
  }

  for (const [at, inv] of file.invoices.entries()) {
    const billNo = inv.billNo.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.date)) throw new Error(`Bill ${billNo}: date must be yyyy-mm-dd`)
    if (!inv.lines?.length) throw new Error(`Bill ${billNo}: no lines`)
    const cust = customerByRef.get(inv.customer.trim().toUpperCase()) ?? customerByRef.get(norm(inv.customer))
    if (!cust) throw new Error(`Bill ${billNo}: customer "${inv.customer}" is not in the file's customers list`)

    sale: {
      const { lines, missing } = resolveLines(`Bill ${billNo}`, inv.lines)
      const totals = checkWritten(`Bill ${billNo}`, inv.lines, inv.billDiscPct, inv.written)
      const paidOnInvoice = inv.paid === 'full' ? totals.netTotal : (inv.paid ?? 0)
      if (paidOnInvoice > totals.netTotal + 0.004) throw new Error(`Bill ${billNo}: paid ${rs(paidOnInvoice)} is more than the net total`)

      const row: SaleReport = {
        billNo,
        date: inv.date,
        customer: cust.name,
        status: 'new',
        lines: lines.length,
        units: totals.units,
        freeUnits: totals.freeUnits,
        gross: totals.gross,
        subTotal: totals.subTotal,
        billDiscount: totals.billDiscount,
        netTotal: totals.netTotal,
        paidOnInvoice,
        photos: inv.photos ?? [],
        photosAttached: 0,
      }
      // already entered? — by the bill number kept in the notes, or the same customer, date and net total
      const [byNote] = await db.select({ id: salesInvoices.id, invoiceNo: salesInvoices.invoiceNo }).from(salesInvoices).where(ilike(salesInvoices.notes, `%${billTag(billNo)}%`))
      let dup = byNote ? { ...byNote, why: `notes carry "${billTag(billNo)}"` } : undefined
      if (!dup && cust.id) {
        const [same] = await db
          .select({ id: salesInvoices.id, invoiceNo: salesInvoices.invoiceNo })
          .from(salesInvoices)
          .where(and(eq(salesInvoices.customerId, cust.id), eq(salesInvoices.date, inv.date), eq(salesInvoices.netTotal, totals.netTotal)))
        if (same) dup = { ...same, why: `same customer, date and net total` }
      }
      report.invoices.push(row)
      if (dup) {
        row.status = 'already entered'
        row.id = dup.id
        row.invoiceNo = dup.invoiceNo
        row.why = dup.why
        row.photosAttached = await photoCount(db, 'sale', dup.id)
        break sale
      }
      if (missing.length) {
        row.status = 'skipped'
        row.why = `not in Products: ${missing.join(', ')} — add the item (and its purchase) first`
        break sale
      }
      // stock, in bill order: a bill that would take any item below zero is skipped, the rest go ahead
      const short: string[] = []
      const need = new Map<number, number>()
      for (const l of lines) need.set(l.productId, (need.get(l.productId) ?? 0) + l.qty + l.freeQty)
      for (const [productId, units] of need) {
        const left = (remaining.get(productId) ?? 0) - units
        if (left < 0 && !negativeOk) {
          const p = allProducts.find((x) => x.id === productId)!
          short.push(`${p.size} ${p.name} (${remaining.get(productId) ?? 0} on hand, ${units} to sell)`)
        }
      }
      if (short.length) {
        row.status = 'skipped'
        row.why = `not enough stock: ${short.join(', ')} — enter the missing purchase first`
        break sale
      }
      for (const [productId, units] of need) {
        remaining.set(productId, (remaining.get(productId) ?? 0) - units)
        leaving.set(productId, (leaving.get(productId) ?? 0) + units)
      }
      resolved.push({ at, inv, row, customerKey: cust.code, lines })
    }

    // ---- the goods handed back on this bill ("RTN" lines) → a sales return of the same date, whatever became of the sale
    const ret = inv.return
    if (!ret) continue
    const tag = `Bill ${billNo} (return)`
    if (!ret.lines?.length) throw new Error(`${tag}: no lines`)
    const reason = ret.reason ?? 'Unsold stock'
    if (!RETURN_REASONS.includes(reason)) throw new Error(`${tag}: reason "${reason}" must be one of ${RETURN_REASONS.join(', ')}`)
    const restock = ret.restock ?? true
    const billDiscPct = ret.billDiscPct ?? inv.billDiscPct
    const { lines: rLines, missing: rMissing } = resolveLines(tag, ret.lines)
    const rt = checkWritten(tag, ret.lines, billDiscPct, ret.written)
    const rrow: ReturnReport = {
      billNo,
      date: inv.date,
      customer: cust.name,
      status: 'new',
      lines: rLines.length,
      units: rt.units,
      freeUnits: rt.freeUnits,
      gross: rt.gross,
      billDiscount: rt.billDiscount,
      netTotal: rt.netTotal,
      restock,
    }
    report.returns.push(rrow)
    // already entered? — by the bill number kept in the return's notes, or the same customer, date and credit
    const [rByNote] = await db.select({ id: salesReturns.id, returnNo: salesReturns.returnNo }).from(salesReturns).where(ilike(salesReturns.notes, `%${billTag(billNo)}%`))
    let rdup = rByNote ? { ...rByNote, why: `notes carry "${billTag(billNo)}"` } : undefined
    if (!rdup && cust.id) {
      const [same] = await db
        .select({ id: salesReturns.id, returnNo: salesReturns.returnNo })
        .from(salesReturns)
        .where(and(eq(salesReturns.customerId, cust.id), eq(salesReturns.date, inv.date), eq(salesReturns.netTotal, rt.netTotal)))
      if (same) rdup = { ...same, why: `same customer, date and credit` }
    }
    if (rdup) {
      rrow.status = 'already entered'
      rrow.id = rdup.id
      rrow.returnNo = rdup.returnNo
      rrow.why = rdup.why
      continue
    }
    if (rMissing.length) {
      rrow.status = 'skipped'
      rrow.why = `not in Products: ${rMissing.join(', ')} — add the item first`
      continue
    }
    if (restock) {
      for (const l of rLines) {
        remaining.set(l.productId, (remaining.get(l.productId) ?? 0) + l.qty + l.freeQty)
        back.set(l.productId, (back.get(l.productId) ?? 0) + l.qty + l.freeQty)
      }
    }
    resolvedReturns.push({
      at,
      row: rrow,
      customerKey: cust.code,
      input: {
        date: inv.date,
        salesInvoiceId: null,
        reason,
        restock,
        billDiscPct,
        refunded: 0,
        refundMethod: '',
        notes: [`${billTag(billNo)} (RTN on the Pasyale bill, deducted from that sale)`, (ret.note ?? '').trim()].filter(Boolean).join('. ').slice(0, 300),
        lines: rLines,
      },
    })
  }

  // ---- stock leaving with the bills that go ahead (and coming back with their returns), against what was on hand
  for (const productId of new Set([...leaving.keys(), ...back.keys()])) {
    const p = allProducts.find((x) => x.id === productId)!
    const onHand = stock.get(productId)?.onHand ?? 0
    const units = leaving.get(productId) ?? 0
    const b = back.get(productId) ?? 0
    report.stock.push({ code: p.code, size: p.size, name: p.name, onHand, units, back: b, after: onHand - units + b })
  }
  report.stock.sort((a, b) => a.name.localeCompare(b.name) || a.size.localeCompare(b.size))
  if (!apply) return report

  // 1. customers (only those with a bill or a return that goes ahead)
  const needed = new Set([...resolved, ...resolvedReturns].map((r) => r.customerKey))
  for (const c of report.customers) {
    if (c.id || !needed.has(c.code)) continue
    const src = file.customers.find((x) => x.code.trim().toUpperCase() === c.code)!
    const type = types.find((t) => t.code === c.typeCode)!
    const input = customerSchema.parse({
      code: c.code,
      name: c.name,
      typeId: type.id,
      phone: src.phone ?? '',
      address: src.address ?? '',
      area: src.area ?? '',
      discPct: src.discPct ?? null,
      creditLimit: src.creditLimit ?? 0,
      creditDays: src.creditDays ?? null,
      notes: src.notes ?? '',
      active: true,
    })
    const [created] = await db.insert(customers).values(input).returning({ id: customers.id })
    c.id = created.id
  }

  // 2. invoices and their returns, in bill order (each in its own transaction; a re-run skips the ones already saved)
  for (let at = 0; at < file.invoices.length; at++) {
    const r = resolved.find((x) => x.at === at)
    if (!r) {
      await applyReturn(at)
      continue
    }
    const cust = customerByRef.get(r.customerKey)!
    const saved = await saveSale(db, {
      date: r.inv.date,
      customerId: cust.id!,
      payMethod: r.inv.payMethod ?? file.payMethod ?? 'Credit',
      billDiscPct: r.inv.billDiscPct,
      paidOnInvoice: r.row.paidOnInvoice,
      chequeNo: r.inv.chequeNo ?? '',
      chequeDate: r.inv.chequeDate ?? null,
      notes: [`${billTag(r.row.billNo)} (Pasyale bill book)`, (r.inv.note ?? '').trim()].filter(Boolean).join('. ').slice(0, 300),
      lines: r.lines,
    })
    r.row.id = saved.id
    r.row.invoiceNo = saved.invoiceNo
    for (const w of saved.warnings) report.warnings.push(`${saved.invoiceNo} (bill ${r.row.billNo}): ${w}`)
    await applyReturn(at)
  }
  async function applyReturn(at: number) {
    const q = resolvedReturns.find((x) => x.at === at)
    if (!q) return
    const cust = customerByRef.get(q.customerKey)!
    const saved = await saveReturn(db, { ...q.input, customerId: cust.id! })
    q.row.id = saved.id
    q.row.returnNo = saved.invoiceNo
    for (const w of saved.warnings) report.warnings.push(`${saved.invoiceNo} (return on bill ${q.row.billNo}): ${w}`)
  }

  // 3. photos — for the invoices saved now, and for ones entered earlier that still have none
  if (opts.photosDir) {
    let upload
    try {
      upload = await chooseUploader(db, 'sale', opts.api)
    } catch (e) {
      report.warnings.push(`photos not attached: ${(e as Error).message}`)
      return report
    }
    for (const row of report.invoices) {
      if (!row.id || !row.invoiceNo || !row.photos.length) continue
      if (row.status === 'already entered' && row.photosAttached > 0) continue
      for (const name of row.photos) {
        try {
          const ok = await upload(row.id, row.invoiceNo, path.join(opts.photosDir, name))
          if (ok) row.photosAttached++
          else report.warnings.push(`bill ${row.billNo}: ${name} is already attached to an invoice — skipped`)
        } catch (e) {
          report.warnings.push(`bill ${row.billNo}: ${name}: ${(e as Error).message} (invoice saved without this photo)`)
        }
      }
    }
  }
  return report
}
