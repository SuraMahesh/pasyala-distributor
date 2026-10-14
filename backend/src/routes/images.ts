import { Router, type Request } from 'express'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { invoiceImageUploadSchema, listQuerySchema, type ImageInvoiceKind, type InvoiceImage, type InvoiceImageRow } from '@pjd/shared'
import type { DB } from '../db/client'
import { customers, invoiceImages, purchaseInvoices, salesInvoices, suppliers } from '../db/schema'
import { AppError, conflict, idParam, notFound, parse } from '../errors'
import { paginate } from '../lib/list'
import { readFile, removeFiles, saveFile, storageKind, storageStatus, type StorageKind } from '../services/files'
import { rows } from '../services/stock'

type Row = typeof invoiceImages.$inferSelect

const KINDS: [ImageInvoiceKind, string][] = [['sale', 'sales'], ['purchase', 'purchases']]

async function invoiceNoOf(db: DB, kind: ImageInvoiceKind, id: number) {
  const [inv] = kind === 'sale'
    ? await db.select({ no: salesInvoices.invoiceNo }).from(salesInvoices).where(eq(salesInvoices.id, id))
    : await db.select({ no: purchaseInvoices.invoiceNo }).from(purchaseInvoices).where(eq(purchaseInvoices.id, id))
  return inv?.no ?? null
}

function toImage(r: Row, invoiceNo: string): InvoiceImage {
  return {
    id: r.id,
    kind: r.salesInvoiceId ? 'sale' : 'purchase',
    invoiceId: (r.salesInvoiceId ?? r.purchaseInvoiceId)!,
    invoiceNo,
    page: r.page,
    size: r.size,
    width: r.width,
    height: r.height,
    rotation: r.rotation,
    createdAt: r.createdAt.toISOString(),
  }
}

const col = (kind: ImageInvoiceKind) => (kind === 'sale' ? invoiceImages.salesInvoiceId : invoiceImages.purchaseInvoiceId)
const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'invoice'

/** Photos of an invoice, so they can be removed with it. */
export async function imagesOf(db: DB, kind: ImageInvoiceKind, invoiceId: number) {
  const list = await db.select().from(invoiceImages).where(eq(col(kind), invoiceId))
  return list.flatMap((r) => [{ storage: r.storage, path: r.path }, { storage: r.storage, path: r.thumbPath }])
}

export function imageRoutes(db: DB) {
  const r = Router()

  r.get('/images/status', (_req, res) => res.json(storageStatus()))

  for (const [kind, base] of KINDS) {
    r.get(`/${base}/:id/images`, async (req, res) => {
      const id = idParam(req.params.id)
      const no = await invoiceNoOf(db, kind, id)
      if (!no) throw notFound('Invoice')
      const list = await db.select().from(invoiceImages).where(eq(col(kind), id)).orderBy(asc(invoiceImages.page), asc(invoiceImages.id))
      res.json(list.map((x) => toImage(x, no)))
    })

    r.post(`/${base}/:id/images`, async (req, res) => {
      const id = idParam(req.params.id)
      const body = parse(invoiceImageUploadSchema, req.body)
      const no = await invoiceNoOf(db, kind, id)
      if (!no) throw notFound('Invoice')
      // same photo already attached somewhere?
      const [dup] = await rows<{ sales_invoice_id: number | null; purchase_invoice_id: number | null; page: number; sale_no: string | null; purchase_no: string | null }>(
        db,
        sql`select i.sales_invoice_id, i.purchase_invoice_id, i.page, s.invoice_no as sale_no, p.invoice_no as purchase_no
            from invoice_images i left join sales_invoices s on s.id = i.sales_invoice_id left join purchase_invoices p on p.id = i.purchase_invoice_id
            where i.sha256 = ${body.sha256}`,
      )
      if (dup) {
        const where = dup.sales_invoice_id ? `sales invoice ${dup.sale_no}` : `purchase invoice ${dup.purchase_no}`
        const same = (kind === 'sale' ? dup.sales_invoice_id : dup.purchase_invoice_id) === id
        throw conflict(same ? `This photo is already attached to this invoice (page ${dup.page}).` : `This photo is already attached to ${where} (page ${dup.page}). Each photo can belong to one invoice only — check you picked the right invoice.`)
      }
      const storage: StorageKind = storageKind()
      const bytes = Buffer.from(body.data, 'base64')
      const thumb = Buffer.from(body.thumb, 'base64')
      if (bytes.length > 1_600_000) throw new AppError(413, 'The photo is too large')
      const [{ next }] = await rows<{ next: number }>(db, sql`select coalesce(max(page), 0) + 1 as next from invoice_images where ${sql.raw(kind === 'sale' ? 'sales_invoice_id' : 'purchase_invoice_id')} = ${id}`)
      const ext = body.mimeType === 'image/png' ? 'png' : body.mimeType === 'image/webp' ? 'webp' : 'jpg'
      const key = `invoices/${kind}/${safe(no)}-${id}/p${next}`
      const saved: { storage: string; path: string }[] = []
      try {
        const path = await saveFile(storage, `${key}.${ext}`, bytes, body.mimeType)
        saved.push({ storage, path })
        const thumbPath = await saveFile(storage, `${key}-thumb.jpg`, thumb, 'image/jpeg')
        saved.push({ storage, path: thumbPath })
        const [row] = await db
          .insert(invoiceImages)
          .values({
            salesInvoiceId: kind === 'sale' ? id : null,
            purchaseInvoiceId: kind === 'purchase' ? id : null,
            page: next, storage, path, thumbPath, mimeType: body.mimeType, size: bytes.length, width: body.width, height: body.height, sha256: body.sha256,
          })
          .returning()
        res.status(201).json(toImage(row, no))
      } catch (e) {
        await removeFiles(saved)
        if (String((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code) === '23505') throw conflict('This photo is already attached to an invoice.')
        throw e
      }
    })
  }

  r.patch('/images/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const { rotation } = parse(z.object({ rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) }), req.body)
    const [row] = await db.update(invoiceImages).set({ rotation }).where(eq(invoiceImages.id, id)).returning()
    if (!row) throw notFound('Image')
    res.json({ ok: true, rotation })
  })

  r.delete('/images/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const [row] = await db.delete(invoiceImages).where(eq(invoiceImages.id, id)).returning()
    if (!row) throw notFound('Image')
    // close the gap in page numbers
    const owner = row.salesInvoiceId ? eq(invoiceImages.salesInvoiceId, row.salesInvoiceId) : eq(invoiceImages.purchaseInvoiceId, row.purchaseInvoiceId!)
    await db.update(invoiceImages).set({ page: sql`${invoiceImages.page} - 1` }).where(and(owner, sql`${invoiceImages.page} > ${row.page}`))
    await removeFiles([{ storage: row.storage, path: row.path }, { storage: row.storage, path: row.thumbPath }])
    res.json({ ok: true })
  })

  r.get('/images/:id/file', async (req: Request, res) => {
    const id = idParam(req.params.id)
    const [row] = await db.select().from(invoiceImages).where(eq(invoiceImages.id, id))
    if (!row) throw notFound('Image')
    const thumb = req.query.size === 'thumb'
    const stream = await readFile(row.storage as StorageKind, thumb ? row.thumbPath : row.path)
    if (!stream) throw notFound('Image file')
    const no = (await invoiceNoOf(db, row.salesInvoiceId ? 'sale' : 'purchase', (row.salesInvoiceId ?? row.purchaseInvoiceId)!)) ?? 'invoice'
    const ext = row.mimeType === 'image/png' ? 'png' : row.mimeType === 'image/webp' ? 'webp' : 'jpg'
    res.setHeader('Content-Type', thumb ? 'image/jpeg' : row.mimeType)
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${safe(no)}-p${row.page}${thumb ? '-small' : ''}.${thumb ? 'jpg' : ext}"`)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  })

  // gallery: every invoice photo, newest first
  r.get('/images', async (req, res) => {
    const q = listQuerySchema.extend({ kind: z.enum(['', 'sale', 'purchase']).default('') }).parse(req.query)
    const list = await db
      .select({
        img: invoiceImages,
        saleNo: salesInvoices.invoiceNo, saleDate: salesInvoices.date, saleTotal: salesInvoices.netTotal, customer: customers.name,
        purchaseNo: purchaseInvoices.invoiceNo, purchaseDate: purchaseInvoices.date, purchaseTotal: purchaseInvoices.netTotal, supplier: suppliers.name,
      })
      .from(invoiceImages)
      .leftJoin(salesInvoices, eq(salesInvoices.id, invoiceImages.salesInvoiceId))
      .leftJoin(customers, eq(customers.id, salesInvoices.customerId))
      .leftJoin(purchaseInvoices, eq(purchaseInvoices.id, invoiceImages.purchaseInvoiceId))
      .leftJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    let items: InvoiceImageRow[] = list.map((x) => ({
      ...toImage(x.img, (x.saleNo ?? x.purchaseNo)!),
      date: (x.saleDate ?? x.purchaseDate)!,
      partyName: (x.customer ?? x.supplier) ?? '',
      netTotal: (x.saleTotal ?? x.purchaseTotal) ?? 0,
    }))
    if (q.kind) items = items.filter((i) => i.kind === q.kind)
    const { filtered: _f, ...page } = paginate(items, q, {
      search: (i) => `${i.invoiceNo} ${i.partyName} ${i.date}`,
      sorters: { date: (i) => `${i.date}-${String(i.invoiceId).padStart(9, '0')}-${i.page}`, invoiceNo: (i) => i.invoiceNo, party: (i) => i.partyName },
      defaultSort: { key: 'date', dir: 'desc' },
    })
    res.json(page)
  })

  return r
}
