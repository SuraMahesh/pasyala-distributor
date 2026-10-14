import Anthropic from '@anthropic-ai/sdk'
import { Router } from 'express'
import { asc, sql } from 'drizzle-orm'
import { z } from 'zod'
import { scanInvoiceSchema, type RawScan } from '@pjd/shared'
import type { DB } from '../db/client'
import { customers, products, purchaseInvoices, suppliers } from '../db/schema'
import { AppError, parse } from '../errors'
import { rows } from '../services/stock'
import { buildScanResult, defaultScanner, type InvoiceScanner } from '../services/scan'

/** POST /api/scan-invoice — read an invoice photo/PDF and return a draft for the user to check before saving. Nothing is saved here. */
export function scanRoutes(db: DB, scanner: InvoiceScanner | null = defaultScanner()) {
  const r = Router()

  r.get('/scan-invoice/status', (_req, res) => {
    // ai: Claude reads the image on the server. Without a key the browser reads it with offline OCR.
    res.json({ enabled: true, ai: !!scanner })
  })

  const context = async (kind: 'sale' | 'purchase') => {
    const catalog = (await db.select({ id: products.id, code: products.code, name: products.name, size: products.size, active: products.active }).from(products).orderBy(asc(products.name)))
      .filter((p) => p.active)
    const parties = kind === 'purchase'
      ? await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers)
      : await db.select({ id: customers.id, name: customers.name }).from(customers)
    const existing = kind === 'purchase'
      ? new Set((await db.select({ no: purchaseInvoices.invoiceNo }).from(purchaseInvoices)).map((x) => x.no.toUpperCase().replace(/[^A-Z0-9.]/g, '')))
      : new Set<string>()
    const last = kind === 'purchase'
      ? await rows<{ supplier_id: number; bill_disc_pct: number }>(db, sql`select distinct on (supplier_id) supplier_id, bill_disc_pct from purchase_invoices order by supplier_id, date desc, created_at desc, id desc`)
      : []
    const lastBillDisc = new Map(last.map((r) => [r.supplier_id, Number(r.bill_disc_pct)]))
    return { catalog, parties, existing, lastBillDisc }
  }

  /** Offline OCR path: the browser already turned the image into lines; check + match them here. */
  r.post('/scan-invoice/parse', async (req, res) => {
    const body = parse(z.object({ kind: z.enum(['sale', 'purchase']), raw: z.record(z.string(), z.unknown()) }), req.body)
    const raw = body.raw as RawScan
    if (!Array.isArray(raw.lines) || raw.lines.length > 300) throw new AppError(400, 'Nothing readable was found')
    const { catalog, parties, existing, lastBillDisc } = await context(body.kind)
    res.json(buildScanResult(body.kind, raw, catalog, parties, existing, { lastBillDisc }))
  })

  r.post('/scan-invoice', async (req, res) => {
    if (!scanner) throw new AppError(503, 'Invoice scanning is not set up. Add ANTHROPIC_API_KEY to the server settings (Vercel → Settings → Environment Variables) and redeploy.')
    const file = parse(scanInvoiceSchema, req.body)
    const { catalog, parties, existing, lastBillDisc } = await context(file.kind)
    let raw
    try {
      raw = await scanner({ file, catalog, parties })
    } catch (e) {
      if (e instanceof AppError) throw e
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AppError(503, 'The ANTHROPIC_API_KEY on the server is not valid.')
      if (e instanceof Anthropic.RateLimitError) throw new AppError(429, 'Too many scans right now — wait a minute and try again.')
      if (e instanceof Anthropic.BadRequestError) throw new AppError(400, `The file could not be read: ${e.message}`)
      throw new AppError(502, 'Could not read the invoice right now — try again, or enter it by hand.')
    }
    res.json(buildScanResult(file.kind, raw, catalog, parties, existing, { lastBillDisc }))
  })
  return r
}
