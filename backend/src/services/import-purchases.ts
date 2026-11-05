/**
 * Bulk entry of supplier invoices (GRNs) transcribed from paper — the same as typing them on
 * Purchases → New, but checked against the printed totals before anything is written.
 *
 * Input: a JSON file (see src/db/imports/purchases-2026-10-21.json). Products are matched by the
 * supplier's item code, else by size + name; the rest are created with the ERP's own rules
 * (createProduct). Photos of the pages can be attached too (`photosDir`).
 *
 * Dry run unless `apply` is true. Safe to run again: invoices already entered are skipped.
 */
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import {
  CATEGORIES,
  guessCategory,
  invoiceTotals,
  normaliseSize,
  productSchema,
  rs,
  type Category,
  type LineInput,
  type PayMethod,
} from '@pjd/shared'
import type { DB } from '../db/client'
import { products, purchaseInvoices, suppliers } from '../db/schema'
import { createProduct } from '../routes/catalog'
import { chooseUploader, photoCount, type ApiTarget } from './import-photos'
import { savePurchase } from './invoices'

export interface ImportLine {
  /** supplier item code; empty when the prefix was not readable → the ERP makes a code */
  code?: string
  /** the readable part of a cut-off code (report only) */
  codeStem?: string
  size: string
  name: string
  qty: number
  free?: number
  price: number
  /** default: file.lineDiscPct */
  discPct?: number
  /** for a new product; default from categoryByPrefix, else guessed from the name */
  category?: Category
  /** for a new product; default = price (supplier list price / MRP) */
  sellPrice?: number
  note?: string
}

export interface ImportInvoice {
  invoiceNo: string
  orderNo?: string
  date: string
  salesPerson?: string
  payMethod?: PayMethod
  billDiscPct?: number
  /** totals printed on the paper — the lines must reproduce them or nothing is written */
  printed?: { subTotal?: number; netTotal?: number; note?: string }
  /** file names inside photosDir, page order; `<name>-thumb.jpg` must exist beside each */
  photos?: string[]
  lines: ImportLine[]
}

export interface ImportFile {
  supplierCode: string
  salesPerson?: string
  payMethod?: PayMethod
  billDiscPct?: number
  lineDiscPct?: number
  /** true: paid on the invoice in full (Cash), as the seed invoices are */
  paidInFull?: boolean
  categoryByPrefix?: Record<string, Category>
  invoices: ImportInvoice[]
}

export interface NewProduct {
  key: string
  id?: number
  code: string
  codeStem?: string
  name: string
  size: string
  category: Category
  listPrice: number
  supplierDiscPct: number
  sellPrice: number
  reorderLevel: number
}

export interface InvoiceReport {
  invoiceNo: string
  date: string
  status: 'new' | 'already entered'
  id?: number
  lines: number
  units: number
  freeUnits: number
  subTotal: number
  netTotal: number
  paidOnInvoice: number
  photos: string[]
  photosAttached: number
}

export interface ImportReport {
  apply: boolean
  supplier: { id: number; code: string; name: string }
  newProducts: NewProduct[]
  /** existing products found by size + name whose code differs from the invoice */
  matchedByName: { code: string; wanted: string; size: string; name: string }[]
  invoices: InvoiceReport[]
  /** units (paid + free) added per product by the invoices that are new */
  stock: { code: string; size: string; name: string; units: number }[]
  warnings: string[]
}

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ')
const key = (size: string, name: string) => `${normaliseSize(size)}|${norm(name)}`
const reorderFor = (size: string) => (size === '30ML' || size === '30g' ? 24 : size === '4.5L' ? 1 : 3)

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

/** Same product under a slightly different spelling (ASHWAGANDA / ASHWAGANDHA), not a different product. */
function similarName(a: string, b: string) {
  const x = norm(a).replace(/[^A-Z0-9]/g, '')
  const y = norm(b).replace(/[^A-Z0-9]/g, '')
  return x === y || x.includes(y) || y.includes(x) || levenshtein(x, y) <= 2
}

type ResolvedLine = { productId?: number; newKey?: string; qty: number; freeQty: number; unitPrice: number; discPct: number }

export interface ImportOptions {
  apply?: boolean
  photosDir?: string
  api?: ApiTarget
}

export async function importPurchases(db: DB, file: ImportFile, opts: ImportOptions = {}): Promise<ImportReport> {
  const apply = !!opts.apply
  const supplierCode = file.supplierCode.trim().toUpperCase()
  const [sup] = await db.select().from(suppliers).where(eq(suppliers.code, supplierCode))
  if (!sup) throw new Error(`Supplier ${supplierCode} does not exist — add the supplier first`)
  if (!file.invoices?.length) throw new Error('The file has no invoices')

  const all = await db.select().from(products)
  const byCode = new Map(all.map((p) => [p.code.toUpperCase(), p]))
  const byKey = new Map(all.map((p) => [key(p.size, p.name), p]))
  const newByKey = new Map<string, NewProduct>()

  const report: ImportReport = {
    apply,
    supplier: { id: sup.id, code: sup.code, name: sup.name },
    newProducts: [],
    matchedByName: [],
    invoices: [],
    stock: [],
    warnings: [],
  }
  const resolved: { inv: ImportInvoice; invoiceNo: string; billDiscPct: number; lines: ResolvedLine[]; paidOnInvoice: number; row: InvoiceReport }[] = []
  const unitsByKey = new Map<string, { code: string; size: string; name: string; units: number }>()

  for (const inv of file.invoices) {
    const invoiceNo = inv.invoiceNo.trim().toUpperCase()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.date)) throw new Error(`${invoiceNo}: date must be yyyy-mm-dd`)
    if (!inv.lines?.length) throw new Error(`${invoiceNo}: no lines`)
    const billDiscPct = inv.billDiscPct ?? file.billDiscPct ?? 0
    const [dup] = await db
      .select({ id: purchaseInvoices.id })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.supplierId, sup.id), eq(purchaseInvoices.invoiceNo, invoiceNo)))

    const lines: ResolvedLine[] = []
    for (const l of inv.lines) {
      const code = (l.code ?? '').trim().toUpperCase()
      const k = key(l.size, l.name)
      const discPct = l.discPct ?? file.lineDiscPct ?? 0
      if (!Number.isInteger(l.qty) || l.qty < 0 || !Number.isInteger(l.free ?? 0) || (l.free ?? 0) < 0 || l.qty + (l.free ?? 0) === 0) {
        throw new Error(`${invoiceNo}: ${l.size} ${l.name}: qty/free must be whole numbers and not both 0`)
      }
      if (!(l.price >= 0)) throw new Error(`${invoiceNo}: ${l.size} ${l.name}: bad price`)
      const line: ResolvedLine = { qty: l.qty, freeQty: l.free ?? 0, unitPrice: l.price, discPct }
      const hit = code ? byCode.get(code) : undefined
      if (hit) {
        if (normaliseSize(hit.size) !== normaliseSize(l.size) || !similarName(hit.name, l.name)) {
          throw new Error(`${invoiceNo}: code ${code} is "${hit.size} ${hit.name}" in the ERP but "${l.size} ${l.name}" on the invoice — check that product before importing (nothing written)`)
        }
        line.productId = hit.id
      } else if (byKey.has(k)) {
        const p = byKey.get(k)!
        line.productId = p.id
        const wanted = code || (l.codeStem ? `…${l.codeStem}` : '')
        if (wanted && p.code !== code && !report.matchedByName.some((m) => m.code === p.code && m.wanted === wanted)) {
          report.matchedByName.push({ code: p.code, wanted, size: p.size, name: p.name })
        }
      } else if (!dup) {
        line.newKey = k
        const existing = newByKey.get(k)
        if (!existing) {
          const prefix = code.replace(/[^A-Z]/g, '').slice(0, 2)
          const category: Category =
            l.category ?? file.categoryByPrefix?.[prefix] ?? guessCategory(code, l.name, all.map((p) => ({ code: p.code, category: p.category as Category })))
          if (!CATEGORIES.includes(category)) throw new Error(`${invoiceNo}: ${l.size} ${l.name}: unknown category "${category}"`)
          newByKey.set(k, {
            key: k,
            code,
            codeStem: l.codeStem,
            name: norm(l.name),
            size: normaliseSize(l.size),
            category,
            listPrice: l.price,
            supplierDiscPct: discPct,
            sellPrice: l.sellPrice ?? l.price,
            reorderLevel: reorderFor(normaliseSize(l.size)),
          })
        } else if (code && existing.code && existing.code !== code) {
          report.warnings.push(`${l.size} ${l.name} appears with two codes (${existing.code}, ${code}) — ${existing.code} is used`)
        } else if (code && !existing.code) {
          existing.code = code
        }
      }
      lines.push(line)
    }

    const totals = invoiceTotals(lines, billDiscPct)
    const printed = inv.printed
    if (printed?.subTotal != null && Math.abs(printed.subTotal - totals.subTotal) > 0.004) {
      throw new Error(`${invoiceNo}: the lines add up to ${rs(totals.subTotal)} but the printed sub total is ${rs(printed.subTotal)} — fix the transcription first (nothing written)`)
    }
    if (printed?.netTotal != null && Math.abs(printed.netTotal - totals.netTotal) > 0.004) {
      throw new Error(`${invoiceNo}: net total ${rs(totals.netTotal)} does not match the printed ${rs(printed.netTotal)} — check the bill discount (nothing written)`)
    }
    const paidOnInvoice = file.paidInFull ? totals.netTotal : 0
    const row: InvoiceReport = {
      invoiceNo,
      date: inv.date,
      status: dup ? 'already entered' : 'new',
      id: dup?.id,
      lines: lines.length,
      units: totals.units,
      freeUnits: totals.freeUnits,
      subTotal: totals.subTotal,
      netTotal: totals.netTotal,
      paidOnInvoice,
      photos: inv.photos ?? [],
      photosAttached: 0,
    }
    report.invoices.push(row)
    if (dup) {
      row.photosAttached = await photoCount(db, 'purchase', dup.id)
      continue
    }
    resolved.push({ inv, invoiceNo, billDiscPct, lines, paidOnInvoice, row })
    for (const [i, l] of lines.entries()) {
      const src = inv.lines[i]
      const k = key(src.size, src.name)
      const p = l.productId ? all.find((x) => x.id === l.productId)! : newByKey.get(k)!
      const cur = unitsByKey.get(k) ?? { code: p.code || `(new) ${src.codeStem ?? ''}`.trim(), size: normaliseSize(src.size), name: norm(src.name), units: 0 }
      cur.units += l.qty + l.freeQty
      unitsByKey.set(k, cur)
    }
  }
  report.newProducts = [...newByKey.values()]
  // a new product that looks like one the ERP already has (same size, nearly the same name) is worth a look
  for (const np of report.newProducts) {
    const alike = all.filter((p) => normaliseSize(p.size) === np.size && similarName(p.name, np.name))
    if (alike.length) {
      report.warnings.push(`${np.size} ${np.name} looks like ${alike.map((p) => `${p.code} ${p.size} ${p.name}`).join(', ')} — it will be created as a separate product; if it is the same thing, rename the existing product to "${np.name}" and run again`)
    }
  }
  report.stock = [...unitsByKey.values()].sort((a, b) => a.name.localeCompare(b.name) || a.size.localeCompare(b.size))
  if (!apply) return report

  // 1. products the ERP does not have yet
  const idByKey = new Map<string, number>()
  for (const np of report.newProducts) {
    const input = productSchema.parse({
      code: np.code,
      name: np.name,
      size: np.size,
      category: np.category,
      listPrice: np.listPrice,
      supplierDiscPct: np.supplierDiscPct,
      sellPrice: np.sellPrice,
      reorderLevel: np.reorderLevel,
      openingStock: 0,
      active: true,
    })
    const created = await createProduct(db, input)
    np.id = created.id
    np.code = created.code
    idByKey.set(np.key, created.id)
    const s = report.stock.find((x) => x.size === np.size && x.name === np.name)
    if (s) s.code = created.code
  }

  // 2. the invoices (each in its own transaction; a re-run skips the ones already saved)
  for (const r of resolved) {
    const lines: LineInput[] = r.lines.map((l) => ({
      productId: l.productId ?? idByKey.get(l.newKey!)!,
      qty: l.qty,
      freeQty: l.freeQty,
      unitPrice: l.unitPrice,
      discPct: l.discPct,
    }))
    const saved = await savePurchase(db, {
      invoiceNo: r.invoiceNo,
      orderNo: (r.inv.orderNo ?? '').trim(),
      date: r.inv.date,
      supplierId: sup.id,
      salesPerson: (r.inv.salesPerson ?? file.salesPerson ?? '').trim(),
      payMethod: r.inv.payMethod ?? file.payMethod ?? 'Cash',
      billDiscPct: r.billDiscPct,
      paidOnInvoice: r.paidOnInvoice,
      notes: '',
      lines,
    })
    r.row.id = saved.id
  }

  // 3. photos of the pages — for the invoices saved now, and for ones entered earlier that still have no photo
  if (opts.photosDir) {
    let upload
    try {
      upload = await chooseUploader(db, 'purchase', opts.api)
    } catch (e) {
      report.warnings.push(`photos not attached: ${(e as Error).message}`)
      return report
    }
    for (const row of report.invoices) {
      if (!row.id || !row.photos.length) continue
      if (row.status === 'already entered' && row.photosAttached > 0) continue
      for (const name of row.photos) {
        try {
          const ok = await upload(row.id, row.invoiceNo, path.join(opts.photosDir, name))
          if (ok) row.photosAttached++
          else report.warnings.push(`${row.invoiceNo}: ${name} is already attached to an invoice — skipped`)
        } catch (e) {
          report.warnings.push(`${row.invoiceNo}: ${name}: ${(e as Error).message} (invoice saved without this photo)`)
        }
      }
    }
  }
  return report
}
