import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { _resetAuthLimits } from './auth'
import { openDatabase, runMigrations, type Database } from './db/client'
import { seed } from './db/seed'
import { imageSize } from './services/import-photos'
import { importPurchases, type ImportFile } from './services/import-purchases'
import { importSales, type SalesImportFile } from './services/import-sales'
import { getPurchase, getSale } from './services/invoices'
import { rows, stockMap } from './services/stock'

// The invoices of 2026-10-21, entered on top of the seed data (as on the live database), then those of the 22nd,
// then the handwritten sales bills of 12–15 October.
const load = <T>(name: string) => JSON.parse(readFileSync(new URL(`./db/imports/${name}`, import.meta.url), 'utf8')) as T
const file = load<ImportFile>('purchases-2026-10-21.json')
const file2 = load<ImportFile>('purchases-2026-10-22.json')
const sales = load<SalesImportFile>('sales-2026-10.json')

let database: Database
const photosDir = mkdtempSync(path.join(tmpdir(), 'pjd-import-photos-'))
const count = async (table: string) => Number((await rows<{ n: number }>(database.db, sql.raw(`select count(*)::int as n from ${table}`)))[0].n)

/** A valid (if blank) baseline JPEG with the given size — enough for imageSize() and the JPEG sniff. */
function fakeJpeg(width: number, height: number) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  // a comment segment pads the file past the upload schema's minimum size
  const comment = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0xca]), Buffer.alloc(200, 0x20)])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, comment, sof, Buffer.from([0xff, 0xd9])])
}

beforeAll(async () => {
  process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), 'pjd-import-uploads-'))
  delete process.env.BLOB_READ_WRITE_TOKEN
  delete process.env.BLOB_STORE_ID
  process.env.PGLITE_DIR = 'memory://'
  database = await openDatabase(undefined)
  await runMigrations(database)
  await seed(database.db)
  let n = 0
  for (const inv of [...file.invoices, ...file2.invoices, ...sales.invoices]) {
    for (const photo of inv.photos ?? []) {
      n++
      writeFileSync(path.join(photosDir, photo), fakeJpeg(1000 + n, 1400 + n))
      writeFileSync(path.join(photosDir, photo.replace(/\.jpg$/, '-thumb.jpg')), fakeJpeg(230, 320))
    }
  }
})

afterAll(async () => {
  await database?.close()
})

describe('import of the 2026-10-21 Pasyale invoices', () => {
  it('the preview matches the printed totals and writes nothing', async () => {
    const before = { purchases: await count('purchase_invoices'), products: await count('products') }
    const r = await importPurchases(database.db, file)
    expect(r.apply).toBe(false)
    expect(r.invoices.map((i) => i.status)).toEqual(['new', 'new', 'new', 'new', 'new'])
    for (const i of r.invoices) {
      const printed = file.invoices.find((x) => x.invoiceNo === i.invoiceNo)!.printed!
      expect(i.subTotal, i.invoiceNo).toBe(printed.subTotal)
      expect(i.netTotal, i.invoiceNo).toBe(printed.netTotal)
    }
    expect(r.newProducts.length).toBeGreaterThan(50)
    // codes the photo cut off are left to the ERP
    expect(r.newProducts.filter((p) => !p.code).every((p) => p.codeStem)).toBe(true)
    expect(await count('purchase_invoices')).toBe(before.purchases)
    expect(await count('products')).toBe(before.products)
  })

  it('a transcription that does not add up is refused before anything is written', async () => {
    const bad = structuredClone(file)
    bad.invoices[0].lines[0].qty += 1
    await expect(importPurchases(database.db, bad, { apply: true })).rejects.toThrow(/printed sub total/)
    expect(await count('purchase_invoices')).toBe(5)
    expect(await count('products')).toBe(53)
  })

  it('a code that belongs to a different product is refused', async () => {
    const bad = structuredClone(file)
    bad.invoices[0].lines[0].code = 'THMN0030' // 30ML MAHA NARAYANA, not 50g ASHWAGANDA RASAYANA
    await expect(importPurchases(database.db, bad, { apply: true })).rejects.toThrow(/THMN0030/)
    expect(await count('purchase_invoices')).toBe(5)
  })

  it('apply enters the five invoices with the printed totals, new products and the page photos', async () => {
    const r = await importPurchases(database.db, file, { apply: true, photosDir })
    expect(r.warnings).toEqual([])
    expect(await count('purchase_invoices')).toBe(10)
    expect(await count('products')).toBe(53 + r.newProducts.length)
    expect(r.newProducts.every((p) => p.id && p.code)).toBe(true)
    for (const i of r.invoices) {
      expect(i.status).toBe('new')
      const printed = file.invoices.find((x) => x.invoiceNo === i.invoiceNo)!.printed!
      const detail = await getPurchase(database.db, i.id!)
      expect(detail.subTotal, i.invoiceNo).toBe(printed.subTotal)
      expect(detail.netTotal, i.invoiceNo).toBe(printed.netTotal)
      expect(detail.status, i.invoiceNo).toBe('paid')
      expect(detail.lines.length).toBe(i.lines)
      expect(i.photosAttached).toBe(2)
    }
    expect(await count('invoice_images')).toBe(10)
    const [img] = await rows<{ width: number; height: number; page: number; mime_type: string }>(database.db, sql`select width, height, page, mime_type from invoice_images order by id limit 1`)
    expect(img).toMatchObject({ width: 1001, height: 1401, page: 1, mime_type: 'image/jpeg' })
    // the handwritten retail price on HOSI006157 is kept as the sell price of the new product
    const [bala] = await rows<{ sell_price: number; list_price: number }>(database.db, sql`select sell_price, list_price from products where code = 'THBA0030'`)
    expect(bala).toMatchObject({ sell_price: 240, list_price: 250 })
    // stock: 180 + 15 free of 30ML PINDA came in on HOSI006156
    const [pinda] = await rows<{ on_hand: number }>(
      database.db,
      sql`select coalesce(sum(qty + free_qty), 0)::int as on_hand from purchase_lines pl join products p on p.id = pl.product_id where p.code = 'THPN0030'`,
    )
    expect(pinda.on_hand).toBe(195)
  })

  it('running it again changes nothing, except adding photos to an entered invoice that has none', async () => {
    const r = await importPurchases(database.db, file, { apply: true, photosDir })
    expect(r.invoices.every((i) => i.status === 'already entered')).toBe(true)
    expect(r.invoices.map((i) => i.photosAttached)).toEqual([2, 2, 2, 2, 2])
    expect(r.newProducts).toEqual([])
    expect(await count('purchase_invoices')).toBe(10)
    expect(await count('invoice_images')).toBe(10)
    // an invoice whose photos failed to upload earlier gets them on the next run
    const first = r.invoices[0]
    await database.db.execute(sql`delete from invoice_images where purchase_invoice_id = ${first.id}`)
    const again = await importPurchases(database.db, file, { apply: true, photosDir })
    expect(again.warnings).toEqual([])
    expect(again.invoices[0].photosAttached).toBe(2)
    expect(await count('invoice_images')).toBe(10)
  })

  it('the invoices of the 22nd reuse the products of the 21st and match their printed totals', async () => {
    const products = await count('products')
    const r = await importPurchases(database.db, file2, { apply: true, photosDir })
    expect(r.warnings).toEqual([])
    expect(r.invoices.map((i) => i.status)).toEqual(['new', 'new', 'new', 'new', 'new'])
    for (const i of r.invoices) {
      const printed = file2.invoices.find((x) => x.invoiceNo === i.invoiceNo)!.printed!
      const detail = await getPurchase(database.db, i.id!)
      expect(detail.subTotal, i.invoiceNo).toBe(printed.subTotal)
      expect(detail.netTotal, i.invoiceNo).toBe(printed.netTotal)
      expect(detail.status, i.invoiceNo).toBe('paid')
      expect(i.photosAttached).toBe(1)
    }
    const codes = r.newProducts.map((p) => p.code)
    expect(codes).toContain('VTSR0100') // only seen on the 22nd
    expect(codes).not.toContain('RSAS0100') // created by the 21st
    expect(codes).not.toContain('THMN4500') // seed
    expect(await count('products')).toBe(products + r.newProducts.length)
    expect(await count('purchase_invoices')).toBe(15)
    expect(await count('invoice_images')).toBe(15)
  })

  it('can attach the photos through a running ERP site instead of its file store', async () => {
    process.env.APP_PASSWORD = 'import-test-pw'
    _resetAuthLimits()
    const app = createApp(database.db, { scanner: null })
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s))
    })
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const first = (await importPurchases(database.db, file2)).invoices[0]
      await database.db.execute(sql`delete from invoice_images where purchase_invoice_id = ${first.id}`)
      expect(await count('invoice_images')).toBe(14)

      const wrong = await importPurchases(database.db, file2, { apply: true, photosDir, api: { url, password: 'not-it' } })
      expect(wrong.warnings.join(' ')).toMatch(/Wrong password/)
      expect(await count('invoice_images')).toBe(14)
      _resetAuthLimits()

      const r = await importPurchases(database.db, file2, { apply: true, photosDir, api: { url, password: 'import-test-pw' } })
      expect(r.warnings).toEqual([])
      expect(r.invoices[0].photosAttached).toBe(1)
      expect(r.invoices.slice(1).map((i) => i.photosAttached)).toEqual([1, 1, 1, 1])
      expect(await count('invoice_images')).toBe(15)
    } finally {
      await new Promise((resolve) => server.close(resolve))
      delete process.env.APP_PASSWORD
      _resetAuthLimits()
    }
  })

  it('reads JPEG and PNG sizes', () => {
    expect(imageSize(fakeJpeg(1080, 1389))).toEqual({ width: 1080, height: 1389, mimeType: 'image/jpeg' })
  })
})

describe('import of the handwritten sales bills', () => {
  it('the preview matches the written totals, shows the customers and the stock, and writes nothing', async () => {
    const r = await importSales(database.db, sales)
    expect(r.apply).toBe(false)
    expect(r.customers.map((c) => c.status)).toEqual(['new', 'new'])
    expect(r.invoices.map((i) => i.status)).toEqual(['new', 'new', 'new'])
    for (const i of r.invoices) {
      const written = sales.invoices.find((x) => x.billNo === i.billNo)!.written!
      expect(i.gross, i.billNo).toBe(written.gross)
      expect(i.netTotal, i.billNo).toBe(written.netTotal)
      expect(i.paidOnInvoice).toBe(0)
    }
    expect(r.warnings).toEqual([]) // the seed purchases cover every line
    expect(r.stock.every((s) => s.after >= 0)).toBe(true)
    expect(await count('sales_invoices')).toBe(0)
    expect(await count('customers')).toBe(1)
  })

  it('a bill that does not add up is refused; an unknown product or a short stock skips that bill only', async () => {
    const bad = structuredClone(sales)
    bad.invoices[0].lines[0].qty += 1
    await expect(importSales(database.db, bad, { apply: true })).rejects.toThrow(/bill says/)
    // a net rounded by hand on the bill passes with a warning
    const rounded = structuredClone(sales)
    rounded.invoices[0].written!.netTotal = Math.round(rounded.invoices[0].written!.netTotal!) + 0.5
    const rr = await importSales(database.db, rounded)
    expect(rr.warnings.join(' ')).toMatch(/rounds the net/)
    expect(rr.invoices[0].status).toBe('new')
    // unknown product → that bill is skipped, the others go ahead
    const unknown = structuredClone(sales)
    unknown.invoices[2].lines[0] = { code: 'NOPE0001', size: '1L', name: 'NOTHING', qty: 1, price: 16000 }
    const ru = await importSales(database.db, unknown)
    expect(ru.invoices.map((i) => i.status)).toEqual(['new', 'new', 'skipped'])
    expect(ru.invoices[2].why).toMatch(/not in Products: NOPE0001/)
    // short stock → skipped with the shortfall; applying only that bill writes nothing, not even its customer
    const tooMany = structuredClone(sales)
    tooMany.invoices[2].lines[0].qty = 500
    delete tooMany.invoices[2].written
    const only = { ...tooMany, invoices: [tooMany.invoices[2]] }
    const rs = await importSales(database.db, only, { apply: true })
    expect(rs.invoices[0].status).toBe('skipped')
    expect(rs.invoices[0].why).toMatch(/not enough stock: 4.5L SOOLAHARA \(\d+ on hand, 500 to sell\)/)
    expect(await count('sales_invoices')).toBe(0)
    expect(await count('customers')).toBe(1)
  })

  it('apply creates the customers, numbers the invoices, records the dues, takes the stock and attaches the photos', async () => {
    const before = await stockMap(database.db)
    const r = await importSales(database.db, sales, { apply: true, photosDir })
    // 35% off list is below the landed cost (22% + 8% off list) — the ERP's own warning, passed through
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.warnings.filter((w) => !/sold below cost/.test(w))).toEqual([])
    expect(r.customers.every((c) => c.id && c.status === 'new')).toBe(true)
    expect(await count('customers')).toBe(3)
    expect(await count('sales_invoices')).toBe(3)
    expect(r.invoices.map((i) => i.invoiceNo)).toEqual(['PJD-000001', 'PJD-000002', 'PJD-000003'])
    for (const i of r.invoices) {
      const written = sales.invoices.find((x) => x.billNo === i.billNo)!.written!
      const detail = await getSale(database.db, i.id!)
      expect(detail.netTotal, i.billNo).toBe(written.netTotal)
      expect(detail.status, i.billNo).toBe('unpaid')
      expect(detail.payMethod).toBe('Credit')
      expect(detail.notes).toContain(`Bill No ${i.billNo}`)
      expect(i.photosAttached).toBe(1)
    }
    const [jaya] = await rows<{ type: string; disc_pct: number; area: string }>(database.db, sql`select t.code as type, c.disc_pct, c.area from customers c join customer_types t on t.id = c.type_id where c.code = 'JAYASRI-OSU'`)
    expect(jaya).toMatchObject({ type: 'PHARMACY', disc_pct: 35, area: 'Gokarella' })
    const after = await stockMap(database.db)
    const asamodagam = [...after.values()].find((s) => s.label.includes('NPAS0375'))!
    const wasBefore = [...before.values()].find((s) => s.label.includes('NPAS0375'))!
    expect(wasBefore.onHand - asamodagam.onHand).toBe(300) // 240 + 60 free
    expect(await count('invoice_images')).toBe(18)
  })

  it('running it again changes nothing', async () => {
    const r = await importSales(database.db, sales, { apply: true, photosDir })
    expect(r.invoices.every((i) => i.status === 'already entered' && i.why?.includes('Bill No'))).toBe(true)
    expect(r.customers.every((c) => c.status === 'existing')).toBe(true)
    expect(await count('sales_invoices')).toBe(3)
    expect(await count('invoice_images')).toBe(18)
  })

  it('a bill entered by hand (same customer, date and net total) is recognised too', async () => {
    const r = await importSales(database.db, { ...sales, invoices: [{ ...sales.invoices[2], billNo: '999999', photos: [] }] })
    expect(r.invoices[0].status).toBe('already entered')
    expect(r.invoices[0].why).toMatch(/same customer, date and net total/)
  })

  it('reads PNG sizes and rejects other files', () => {
    const png = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
    png.writeUInt32BE(640, 16)
    png.writeUInt32BE(480, 20)
    expect(imageSize(png)).toEqual({ width: 640, height: 480, mimeType: 'image/png' })
    expect(imageSize(Buffer.from('not an image'))).toBeNull()
  })
})
