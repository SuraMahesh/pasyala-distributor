import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addDays, invoiceTotals, todayLK } from '@pjd/shared'
import { createApp } from './app'
import { _resetAuthLimits } from './auth'
import { openDatabase, runMigrations, type Database } from './db/client'
import { PRINTED_TOTALS, seed } from './db/seed'
import type { RawScan } from './services/scan'

// Uses TEST_DATABASE_URL (real PostgreSQL) when set, otherwise an in-memory embedded Postgres.
let database: Database
let api: ReturnType<typeof request>
const ids: Record<string, number> = {}
const today = todayLK()

async function product(code: string) {
  const res = await api.get(`/api/products?search=${code}&pageSize=5`)
  return res.body.items.find((p: { code: string }) => p.code === code)
}

const uploadDir = mkdtempSync(path.join(tmpdir(), 'pjd-uploads-'))

beforeAll(async () => {
  process.env.UPLOAD_DIR = uploadDir
  if (!process.env.TEST_DATABASE_URL) process.env.PGLITE_DIR = 'memory://'
  database = await openDatabase(process.env.TEST_DATABASE_URL)
  if (database.kind === 'postgres') {
    await database.db.execute(sql`drop schema if exists public cascade`)
    await database.db.execute(sql`drop schema if exists drizzle cascade`)
    await database.db.execute(sql`create schema public`)
  }
  await runMigrations(database)
  await seed(database.db)
  api = request(createApp(database.db, { scanner: null }))
  const prods = (await api.get('/api/products/options')).body as { id: number; code: string }[]
  for (const p of prods) ids[p.code] = p.id
  const types = (await api.get('/api/customer-types')).body as { id: number; code: string }[]
  for (const t of types) ids[`type:${t.code}`] = t.id
})

afterAll(async () => {
  await database?.close()
})

describe('starting data from the 5 Pasyale invoices', () => {
  it('every seeded purchase matches the printed sub total and net total', async () => {
    const list = (await api.get('/api/purchases?pageSize=50')).body
    expect(list.total).toBe(5)
    for (const p of list.items) {
      const detail = (await api.get(`/api/purchases/${p.id}`)).body
      expect(detail.subTotal, p.invoiceNo).toBe(PRINTED_TOTALS[p.invoiceNo].sub)
      expect(detail.netTotal, p.invoiceNo).toBe(PRINTED_TOTALS[p.invoiceNo].net)
      expect(detail.status).toBe('paid')
      // the list shows the 8% bill discount of every invoice
      expect(p.billDiscPct, p.invoiceNo).toBe(8)
      expect(p.subTotal, p.invoiceNo).toBe(detail.subTotal)
      expect(p.billDiscount, p.invoiceNo).toBe(detail.billDiscount)
      expect(p.subTotal - p.billDiscount, p.invoiceNo).toBeCloseTo(p.netTotal, 2)
    }
    expect(list.summary.billDiscount).toBeCloseTo(list.items.reduce((s: number, p: { billDiscount: number }) => s + p.billDiscount, 0), 2)
    expect(list.summary.subTotal - list.summary.billDiscount).toBeCloseTo(list.summary.netTotal, 2)
  })

  it('stock includes free issues; the unit cost is the paid price and free issues cost nothing', async () => {
    const p = await product('THMN0030') // 120 + 10 free @ 200 −22% −8%
    expect(p.onHand).toBe(130)
    expect(p.paidOnHand).toBe(120)
    expect(p.freeOnHand).toBe(10)
    expect(p.avgCost).toBeCloseTo(200 * 0.78 * 0.92, 3) // 143.52 = 71.76% of list, not spread over the free units
    const dr = await product('RSDH1000')
    expect(dr.onHand).toBe(50)
    expect(dr.avgCost).toBeCloseTo(4500 * 0.78 * 0.92, 3)
  })

  it('stock value equals what was paid for the goods', async () => {
    const s = (await api.get(`/api/reports/summary?from=2026-10-01&to=2026-10-31`)).body
    expect(s.stockValue).toBeCloseTo(s.purchases, 1)
  })
})

describe('customer types, price rules and promotions', () => {
  it('sets Shop 10% and Medical Center 15% default discounts', async () => {
    for (const [code, pct] of [['SHOP', 10], ['MEDICAL', 15]] as const) {
      const id = ids[`type:${code}`]
      const t = (await api.get('/api/customer-types')).body.find((x: { id: number }) => x.id === id)
      const res = await api.put(`/api/customer-types/${id}`).send({ ...t, defaultDiscPct: pct })
      expect(res.status).toBe(200)
    }
  })

  it('creates a shop and a medical center', async () => {
    const shop = await api.post('/api/customers').send({ code: 'SH001', name: 'Sunil Stores', typeId: ids['type:SHOP'], area: 'Matara', discPct: null, creditLimit: 5000, creditDays: null })
    const mc = await api.post('/api/customers').send({ code: 'MC001', name: 'Siddhi Ayurveda Clinic', typeId: ids['type:MEDICAL'], area: 'Galle', discPct: null, creditLimit: 0, creditDays: 45 })
    expect(shop.status).toBe(201)
    expect(mc.status).toBe(201)
    ids.shop = shop.body.id
    ids.mc = mc.body.id
  })

  it('product rule and promotion change the medical center price list only', async () => {
    const r1 = await api.put('/api/price-rules').send({ rules: [{ productId: ids.THMN0030, customerTypeId: ids['type:MEDICAL'], price: 150, discPct: null }] })
    expect(r1.status).toBe(200)
    const pr = await api.post('/api/promotions').send({ name: 'MC 12+1', productId: ids.THMN0030, customerTypeId: ids['type:MEDICAL'], buyQty: 12, freeQty: 1, startDate: null, endDate: null, active: true })
    expect(pr.status).toBe(201)

    const mcList = (await api.get(`/api/price-list?typeId=${ids['type:MEDICAL']}&search=THMN0030`)).body
    expect(mcList.items[0].quote).toMatchObject({ unitPrice: 150, discPct: 0, source: 'product-rule-price' })
    expect(mcList.items[0].quote.promotion.name).toBe('MC 12+1')

    const shopList = (await api.get(`/api/price-list?typeId=${ids['type:SHOP']}&search=THMN0030`)).body
    expect(shopList.items[0].quote).toMatchObject({ unitPrice: 200, discPct: 10, netUnitPrice: 180, source: 'customer-type' })
    expect(shopList.items[0].quote.promotion).toBeNull()
  })

  it('rejects a rule with both price and discount', async () => {
    const r = await api.put('/api/price-rules').send({ rules: [{ productId: ids.THMN0030, customerTypeId: ids['type:SHOP'], price: 100, discPct: 5 }] })
    expect(r.status).toBe(400)
  })
})

describe('sales invoices', () => {
  const line = (code: string, qty: number, freeQty = 0, unitPrice = 200, discPct = 10) => ({ productId: ids[code], qty, freeQty, unitPrice, discPct })

  it('creates PJD-000001, totals and stock are worked out on the server', async () => {
    const res = await api.post('/api/sales').send({ date: today, customerId: ids.shop, payMethod: 'Credit', billDiscPct: 2, paidOnInvoice: 0, notes: '', lines: [line('THMN0030', 24, 2), line('ATNE0030', 12)] })
    expect(res.status).toBe(201)
    expect(res.body.invoiceNo).toBe('PJD-000001')
    ids.sale1 = res.body.id
    const inv = (await api.get(`/api/sales/${ids.sale1}`)).body
    const expected = invoiceTotals([line('THMN0030', 24, 2), line('ATNE0030', 12)], 2)
    expect(inv.netTotal).toBe(expected.netTotal) // 36 × 200 × 0.9 × 0.98 = 6350.40
    expect(inv.netTotal).toBe(6350.4)
    expect(inv.status).toBe('unpaid')
    expect(inv.lines[0]).toMatchObject({ code: 'THMN0030', qty: 24, freeQty: 2, lineNet: 4320 })
    // charged units at 143.52 (list 200 − 22% − 8%); the 2 free units given cost Rs 0 and the unit cost stays the paid price
    expect(inv.costTotal).toBeCloseTo(24 * 143.52 + 12 * 143.52, 2)
    expect(inv.lines[0].unitCost).toBeCloseTo(143.52, 4)
    expect(inv.lines[1].unitCost).toBeCloseTo(143.52, 4)
    expect((await product('THMN0030')).onHand).toBe(130 - 26)
  })

  it('warns when the shop goes over its credit limit', async () => {
    const res = await api.post('/api/sales').send({ date: today, customerId: ids.shop, payMethod: 'Credit', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [line('THBT0030', 1, 0, 200, 0)] })
    expect(res.status).toBe(201)
    expect(res.body.warnings.join(' ')).toMatch(/over the credit limit/)
    ids.sale2 = res.body.id
  })

  it('warns when selling below cost', async () => {
    const res = await api.post('/api/sales').send({ date: today, customerId: ids.mc, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 50, notes: '', lines: [line('THBT0030', 1, 0, 50, 0)] })
    expect(res.status).toBe(201)
    expect(res.body.warnings.join(' ')).toMatch(/below cost/)
    ids.sale3 = res.body.id
  })

  it('filters the list by payment method', async () => {
    const credit = (await api.get('/api/sales?payMethod=Credit&pageSize=200')).body
    expect(credit.items.length).toBeGreaterThan(0)
    expect(credit.items.every((i: { payMethod: string }) => i.payMethod === 'Credit')).toBe(true)
    expect(credit.items.map((i: { id: number }) => i.id)).toContain(ids.sale1)
    const cash = (await api.get('/api/sales?payMethod=Cash&pageSize=200')).body
    expect(cash.items.map((i: { id: number }) => i.id)).toContain(ids.sale3)
    expect(cash.items.map((i: { id: number }) => i.id)).not.toContain(ids.sale1)
    const all = (await api.get('/api/sales?pageSize=200')).body
    expect(credit.summary.count + cash.summary.count).toBe(all.summary.count) // no cheques or transfers yet
    expect(credit.summary.netTotal + cash.summary.netTotal).toBeCloseTo(all.summary.netTotal, 2)
    expect((await api.get('/api/sales?payMethod=Nope')).status).toBe(400)
  })

  it('refuses to oversell and does not use up an invoice number', async () => {
    const before = (await api.get('/api/settings')).body.nextInvoiceNo
    const res = await api.post('/api/sales').send({ date: today, customerId: ids.shop, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [line('RSDH1000', 51)] })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/Not enough stock: 1kg DHATHRI RASAYANA \(RSDH1000\) is short by 1 \(50 in stock now\)/)
    expect((await api.get('/api/settings')).body.nextInvoiceNo).toBe(before)
    expect((await product('RSDH1000')).onHand).toBe(50)
  })

  it('editing can reuse the invoice\'s own stock; delete returns stock', async () => {
    // sell all 50, then edit the same invoice to 50 again (allowed because its own 50 come back first)
    const created = await api.post('/api/sales').send({ date: today, customerId: ids.mc, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [line('RSDH1000', 50, 0, 4500, 15)] })
    expect(created.status).toBe(201)
    expect((await product('RSDH1000')).onHand).toBe(0)
    const edit = await api.put(`/api/sales/${created.body.id}`).send({ date: today, customerId: ids.mc, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: 'edited', lines: [line('RSDH1000', 40, 0, 4500, 15)] })
    expect(edit.status).toBe(200)
    expect(edit.body.invoiceNo).toBe(created.body.invoiceNo)
    expect((await product('RSDH1000')).onHand).toBe(10)
    expect((await api.delete(`/api/sales/${created.body.id}`)).status).toBe(200)
    expect((await product('RSDH1000')).onHand).toBe(50)
  })

  it('re-costing changes nothing already costed with the rule, and repairs a tampered invoice', async () => {
    const { recostSales } = await import('./services/recost')
    const before = await recostSales(database.db, false)
    expect(before.changed).toBe(0)
    expect(before.invoices).toBeGreaterThan(0)
    await database.db.execute(sql`update sales_lines set unit_cost = 1 where invoice_id = ${ids.sale1}`)
    await database.db.execute(sql`update sales_invoices set cost_total = 1 where id = ${ids.sale1}`)
    const preview = await recostSales(database.db, false)
    expect(preview.changed).toBe(1)
    expect((await api.get(`/api/sales/${ids.sale1}`)).body.costTotal).toBe(1) // preview wrote nothing
    const fixed = await recostSales(database.db, true)
    expect(fixed.changed).toBe(1)
    expect(fixed.rows[0]).toMatchObject({ invoiceNo: 'PJD-000001', oldCost: 1 })
    expect((await api.get(`/api/sales/${ids.sale1}`)).body.costTotal).toBeCloseTo(36 * 143.52, 2)
    expect((await recostSales(database.db, false)).changed).toBe(0)
  })

  it('validates input with clear messages', async () => {
    const bad = await api.post('/api/sales').send({ date: today, customerId: ids.shop, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [line('THBT0030', 0, 0)] })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/Line 1/)
    const overpaid = await api.post('/api/sales').send({ date: today, customerId: ids.shop, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 999999, notes: '', lines: [line('THBT0030', 1)] })
    expect(overpaid.status).toBe(400)
    expect(overpaid.body.error).toMatch(/more than the invoice total/)
  })
})

describe('payments, balances and overdue', () => {
  it('applies a payment to the oldest invoice first (FIFO)', async () => {
    const pay = await api.post('/api/payments').send({ date: today, partyType: 'customer', partyId: ids.shop, amount: 6400, method: 'Cheque', reference: 'CHQ-1', notes: '' })
    expect(pay.status).toBe(201)
    const s1 = (await api.get(`/api/sales/${ids.sale1}`)).body
    const s2 = (await api.get(`/api/sales/${ids.sale2}`)).body
    expect(s1).toMatchObject({ status: 'paid', due: 0 })
    expect(s2).toMatchObject({ status: 'partial', due: 150.4 }) // 200 − (6400 − 6350.40)
    const c = (await api.get(`/api/customers/${ids.shop}`)).body
    expect(c.customer.balance).toBeCloseTo(6350.4 + 200 - 6400, 2)
    expect(c.statement.at(-1).balance).toBeCloseTo(c.customer.balance, 2)
  })

  it('flags invoices past the credit days as overdue', async () => {
    const old = addDays(today, -40) // shop credit days = 30
    const res = await api.post('/api/sales').send({ date: old, customerId: ids.shop, payMethod: 'Credit', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [{ productId: ids.ATGN0030, qty: 10, freeQty: 0, unitPrice: 170, discPct: 0 }] })
    expect(res.status).toBe(201)
    // FIFO: the payment now covers this OLDER invoice first
    const inv = (await api.get(`/api/sales/${res.body.id}`)).body
    expect(inv.status).toBe('paid')
    const s1 = (await api.get(`/api/sales/${ids.sale1}`)).body
    expect(s1.status).toBe('partial')
    expect(s1.overdue).toBe(false)
    const overdueList = (await api.get('/api/sales?status=overdue')).body
    expect(overdueList.total).toBe(0)

    const res2 = await api.post('/api/sales').send({ date: addDays(today, -60), customerId: ids.mc, payMethod: 'Credit', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [{ productId: ids.ATGN0030, qty: 5, freeQty: 0, unitPrice: 170, discPct: 0 }] })
    expect(res2.status).toBe(201)
    const od = (await api.get('/api/sales?status=overdue')).body
    expect(od.total).toBe(1) // medical center: 45 credit days
    const alerts = (await api.get('/api/alerts')).body as { id: string }[]
    expect(alerts.some((a) => a.id === `overdue-${ids.mc}`)).toBe(true)
    const aging = (await api.get('/api/reports/aging')).body
    expect(aging.find((a: { customerId: number }) => a.customerId === ids.mc).d30).toBe(850)
  })
})

describe('sales returns (credit notes)', () => {
  const line = (code: string, qty: number, freeQty = 0, unitPrice = 200, discPct = 10) => ({ productId: ids[code], qty, freeQty, unitPrice, discPct })
  const ret = (patch: Record<string, unknown>) => ({ date: today, customerId: ids.mc, salesInvoiceId: ids.retSale, reason: 'Unsold stock', restock: true, billDiscPct: 5, refunded: 0, refundMethod: '', notes: '', ...patch })

  it('takes goods back against an invoice: stock returns, the invoice is credited, numbered PJD-R000001', async () => {
    const before = (await product('ATCS0030')).onHand
    const sale = await api.post('/api/sales').send({ date: today, customerId: ids.mc, payMethod: 'Credit', billDiscPct: 5, paidOnInvoice: 0, notes: '', lines: [line('ATCS0030', 20, 2), line('ATGL0030', 6, 0, 280, 0)] })
    expect(sale.status).toBe(201)
    ids.retSale = sale.body.id
    expect((await product('ATCS0030')).onHand).toBe(before - 22)
    const balBefore = (await api.get(`/api/customers/${ids.mc}`)).body.customer.balance

    const res = await api.post('/api/sales-returns').send(ret({ notes: 'back from the shelf', lines: [line('ATCS0030', 4, 1)] }))
    expect(res.status).toBe(201)
    expect(res.body.invoiceNo).toBe('PJD-R000001')
    ids.ret1 = res.body.id
    const r = (await api.get(`/api/sales-returns/${ids.ret1}`)).body
    // 4 × 200 × 0.9 = 720, less 5% bill discount = 684; the free unit is worth 0
    expect(r).toMatchObject({ returnNo: 'PJD-R000001', netTotal: 684, credited: 684, refunded: 0, restock: true, invoiceNo: sale.body.invoiceNo, customerName: 'Siddhi Ayurveda Clinic', notes: 'back from the shelf' })
    expect(r.lines[0]).toMatchObject({ code: 'ATCS0030', qty: 4, freeQty: 1, lineNet: 720 })
    expect(r.lines[0].unitCost).toBeGreaterThan(0)
    expect(r.costTotal).toBeCloseTo(r.lines[0].unitCost * 4, 2) // the free unit coming back costs nothing
    expect((await product('ATCS0030')).onHand).toBe(before - 22 + 5)

    const inv = (await api.get(`/api/sales/${ids.retSale}`)).body
    expect(inv.credited).toBe(684)
    expect(inv.paid).toBe(684)
    expect(inv.due).toBeCloseTo(inv.netTotal - 684, 2)
    expect(inv.status).toBe('partial')
    expect(inv.returns).toEqual([expect.objectContaining({ id: ids.ret1, returnNo: 'PJD-R000001', netTotal: 684, restock: true })])

    const c = (await api.get(`/api/customers/${ids.mc}`)).body
    expect(c.customer.balance).toBeCloseTo(balBefore - 684, 2)
    expect(c.customer.returned).toBe(684)
    expect(c.statement.find((s: { type: string }) => s.type === 'Return')).toMatchObject({ ref: 'PJD-R000001', refId: ids.ret1, credit: 684, debit: 0 })
    expect(c.statement.at(-1).balance).toBeCloseTo(c.customer.balance, 2)
    const moves = (await api.get(`/api/products/${ids.ATCS0030}/movements`)).body.items
    expect(moves[0]).toMatchObject({ type: 'Return', ref: 'PJD-R000001', refId: ids.ret1, qtyIn: 5, qtyOut: 0, party: 'Siddhi Ayurveda Clinic' })
  })

  it('never takes back more than the invoice sold, only items on it, only from its customer', async () => {
    const tooMany = await api.post('/api/sales-returns').send(ret({ lines: [line('ATCS0030', 18)] })) // 22 sold, 5 already back → at most 17
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.error).toMatch(/30ML CASTOR OIL: PJD-\d+ sold 22 and 5 already came back — cannot take back 18/)
    const notOnInvoice = await api.post('/api/sales-returns').send(ret({ lines: [line('THMN0030', 1)] }))
    expect(notOnInvoice.status).toBe(400)
    expect(notOnInvoice.body.error).toMatch(/30ML MAHA NARAYANA is not on PJD-/)
    const wrongCustomer = await api.post('/api/sales-returns').send(ret({ customerId: ids.shop, lines: [line('ATCS0030', 1)] }))
    expect(wrongCustomer.status).toBe(400)
    expect(wrongCustomer.body.error).toMatch(/was sold to Siddhi Ayurveda Clinic, not to Sunil Stores/)
    const refundTooBig = await api.post('/api/sales-returns').send(ret({ refunded: 999999, refundMethod: 'Cash', lines: [line('ATCS0030', 1)] }))
    expect(refundTooBig.status).toBe(400)
    expect(refundTooBig.body.error).toMatch(/more than the return total/)
    const noMethod = await api.post('/api/sales-returns').send(ret({ refunded: 10, lines: [line('ATCS0030', 1)] }))
    expect(noMethod.status).toBe(400)
    expect(noMethod.body.error).toMatch(/how the money was refunded/)
    expect((await api.get('/api/settings')).body.nextReturnNo).toBe(2) // none of the refused returns used a number
  })

  it('the invoice cannot be deleted, or cut below what came back, while the return exists', async () => {
    const del = await api.delete(`/api/sales/${ids.retSale}`)
    expect(del.status).toBe(409)
    expect(del.body.error).toMatch(/sales return PJD-R000001 was recorded against it/)
    const header = { date: today, customerId: ids.mc, payMethod: 'Credit', billDiscPct: 5, paidOnInvoice: 0, notes: '' }
    const edit = await api.put(`/api/sales/${ids.retSale}`).send({ ...header, lines: [line('ATCS0030', 3, 0), line('ATGL0030', 6, 0, 280, 0)] })
    expect(edit.status).toBe(400)
    expect(edit.body.error).toMatch(/30ML CASTOR OIL: 5 already came back on a sales return/)
    const ok = await api.put(`/api/sales/${ids.retSale}`).send({ ...header, lines: [line('ATCS0030', 20, 2), line('ATGL0030', 6, 0, 280, 0)] })
    expect(ok.status).toBe(200)
  })

  it('a write-off leaves stock alone; a cash refund does not come off the balance', async () => {
    const before = (await product('ATGL0030')).onHand
    const bal = (await api.get(`/api/customers/${ids.mc}`)).body.customer.balance
    const res = await api.post('/api/sales-returns').send(ret({ salesInvoiceId: null, reason: 'Damaged', restock: false, billDiscPct: 0, refunded: 280, refundMethod: 'Cash', lines: [line('ATGL0030', 2, 0, 280, 0)] }))
    expect(res.status).toBe(201)
    expect(res.body.invoiceNo).toBe('PJD-R000002')
    ids.ret2 = res.body.id
    expect((await product('ATGL0030')).onHand).toBe(before) // written off: nothing goes back on the shelf
    const r = (await api.get(`/api/sales-returns/${ids.ret2}`)).body
    expect(r).toMatchObject({ netTotal: 560, refunded: 280, credited: 280, refundMethod: 'Cash', restock: false, invoiceNo: null, reason: 'Damaged' })
    const c = (await api.get(`/api/customers/${ids.mc}`)).body
    expect(c.customer.balance).toBeCloseTo(bal - 280, 2)
    expect(c.statement.filter((s: { ref: string }) => s.ref === 'PJD-R000002').map((s: { type: string; debit: number; credit: number }) => [s.type, s.debit, s.credit])).toEqual([['Return', 0, 560], ['Refund', 280, 0]])
    const moves = (await api.get(`/api/products/${ids.ATGL0030}/movements`)).body.items
    expect(moves.some((m: { type: string }) => m.type === 'Return')).toBe(false)
  })

  it('the list, the sales reports and the dashboard are all net of returns', async () => {
    const list = (await api.get('/api/sales-returns?pageSize=50')).body
    expect(list.total).toBe(2)
    expect(list.summary).toMatchObject({ count: 2, netTotal: 1244, refunded: 280, credited: 964, units: 7 })
    expect(list.items.find((i: { returnNo: string }) => i.returnNo === 'PJD-R000002')).toMatchObject({ restock: false, invoiceNo: null, credited: 280, partyName: 'Siddhi Ayurveda Clinic', lineCount: 1, units: 2 })
    expect((await api.get('/api/sales-returns?restock=no')).body.total).toBe(1)
    expect((await api.get(`/api/sales-returns?salesInvoiceId=${ids.retSale}`)).body.total).toBe(1)
    expect((await api.get('/api/sales-returns?search=R000002')).body.total).toBe(1)

    const from = addDays(today, -90)
    const sales = (await api.get('/api/sales?pageSize=200')).body
    const s = (await api.get(`/api/reports/summary?from=${from}&to=${today}`)).body
    expect(s).toMatchObject({ returns: 2, returned: 1244, refunded: 280 })
    expect(s.grossRevenue).toBeCloseTo(sales.summary.netTotal, 2)
    expect(s.revenue).toBeCloseTo(sales.summary.netTotal - 1244, 2)
    expect(s.profit).toBeCloseTo(s.revenue - s.cost, 2)
    const byProduct = (await api.get(`/api/reports/by-product?from=${from}&to=${today}`)).body
    expect(byProduct.find((p: { code: string }) => p.code === 'ATGL0030')).toMatchObject({ qty: 4, free: 0, invoices: 1 }) // 6 sold, 2 back
    expect(byProduct.find((p: { code: string }) => p.code === 'ATCS0030')).toMatchObject({ qty: 16, free: 1 }) // 20 + 2 free sold, 4 + 1 free back
    const byCustomer = (await api.get(`/api/reports/by-customer?from=${from}&to=${today}`)).body
    expect(byCustomer.reduce((a: number, c: { revenue: number }) => a + c.revenue, 0)).toBeCloseTo(s.revenue, 2)
    const byType = (await api.get(`/api/reports/by-type?from=${from}&to=${today}`)).body
    expect(byType.reduce((a: number, t: { revenue: number }) => a + t.revenue, 0)).toBeCloseTo(s.revenue, 2)
    const todaySales = (await api.get(`/api/sales?from=${today}&to=${today}&pageSize=200`)).body
    const daily = (await api.get(`/api/reports/daily?from=${today}&to=${today}`)).body
    expect(daily[0].revenue).toBeCloseTo(todaySales.summary.netTotal - 1244, 2)
    expect(daily[0].invoices).toBe(todaySales.total)
    const d = (await api.get('/api/dashboard')).body
    expect(d.today.revenue).toBeCloseTo(todaySales.summary.netTotal - 1244, 2)
    expect(d.month.returned).toBe(1244)
  })

  it('editing a return re-checks stock; deleting one puts the goods back out — refused once they were sold on', async () => {
    const onHand = (await product('ATCS0030')).onHand
    const edit = await api.put(`/api/sales-returns/${ids.ret1}`).send(ret({ lines: [line('ATCS0030', 6, 0)] }))
    expect(edit.status).toBe(200)
    expect(edit.body.invoiceNo).toBe('PJD-R000001')
    expect((await product('ATCS0030')).onHand).toBe(onHand + 1) // 6 back instead of 4 + 1 free
    expect((await api.get(`/api/sales-returns/${ids.ret1}`)).body.netTotal).toBe(1026) // 6 × 200 × 0.9 × 0.95

    // sell every unit, then the returned goods cannot leave again
    const all = (await product('ATCS0030')).onHand
    const sellAll = await api.post('/api/sales').send({ date: today, customerId: ids.shop, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [line('ATCS0030', all, 0, 200, 0)] })
    expect(sellAll.status).toBe(201)
    const del = await api.delete(`/api/sales-returns/${ids.ret1}`)
    expect(del.status).toBe(409)
    expect(del.body.error).toMatch(/Cannot delete PJD-R000001 — those goods were already sold or used/)
    expect((await api.delete(`/api/sales/${sellAll.body.id}`)).status).toBe(200)

    expect((await api.delete(`/api/sales-returns/${ids.ret1}`)).status).toBe(200)
    expect((await product('ATCS0030')).onHand).toBe(all - 6)
    expect((await api.get(`/api/sales-returns/${ids.ret1}`)).status).toBe(404)
    const inv = (await api.get(`/api/sales/${ids.retSale}`)).body
    expect(inv.returns).toEqual([])
    expect(inv.credited).toBe(0)
    expect((await api.delete(`/api/sales/${ids.retSale}`)).status).toBe(200) // nothing holds the invoice any more
  })
})

describe('cheques on invoices', () => {
  const line = { productId: 0, qty: 2, freeQty: 0, unitPrice: 200, discPct: 0 }
  const sale = (patch: Record<string, unknown>) => ({ date: today, customerId: ids.shop, payMethod: 'Cheque', billDiscPct: 0, paidOnInvoice: 0, notes: '', chequeNo: '123456', chequeDate: null, lines: [{ ...line, productId: ids.ATCS0030 }], ...patch })

  it('a cheque that is not paid yet needs its date, keeps the invoice due and falls due on that date', async () => {
    const noDate = await api.post('/api/sales').send(sale({}))
    expect(noDate.status).toBe(400)
    expect(noDate.body.error).toMatch(/cheque date/i)

    const past = addDays(today, -3)
    const res = await api.post('/api/sales').send(sale({ chequeDate: past }))
    expect(res.status).toBe(201)
    const inv = (await api.get(`/api/sales/${res.body.id}`)).body
    expect(inv).toMatchObject({ payMethod: 'Cheque', chequeNo: '123456', chequeDate: past, paidOnInvoice: 0, netTotal: 400, status: 'unpaid', dueDate: past, overdue: true })
    const pending = (await api.get('/api/sales?status=cheque')).body
    expect(pending.items.map((i: { id: number }) => i.id)).toContain(res.body.id)
    expect((await api.get('/api/sales?search=123456')).body.items[0].id).toBe(res.body.id)

    // a cheque paid on the spot needs no date and is settled
    const paidRes = await api.post('/api/sales').send(sale({ paidOnInvoice: 400, chequeNo: '777' }))
    expect(paidRes.status).toBe(201)
    expect((await api.get(`/api/sales/${paidRes.body.id}`)).body).toMatchObject({ status: 'paid', chequeDate: null })
    expect((await api.get('/api/sales?status=cheque')).body.items.map((i: { id: number }) => i.id)).not.toContain(paidRes.body.id)

    // the cheque clears: the invoice itself becomes paid (not a FIFO payment that would settle older invoices first)
    const cleared = await api.post(`/api/sales/${res.body.id}/cheque-cleared`)
    expect(cleared.status).toBe(200)
    expect(cleared.body).toMatchObject({ invoiceNo: inv.invoiceNo, paidOnInvoice: 400 })
    expect((await api.get(`/api/sales/${res.body.id}`)).body).toMatchObject({ paidOnInvoice: 400, status: 'paid', due: 0, overdue: false, chequeNo: '123456', chequeDate: past })
    expect((await api.get('/api/sales?status=cheque')).body.items.map((i: { id: number }) => i.id)).not.toContain(res.body.id)
    expect((await api.post(`/api/sales/${res.body.id}/cheque-cleared`)).status).toBe(400) // already paid
    expect((await api.post(`/api/sales/${ids.sale1}/cheque-cleared`)).body.error).toMatch(/not paid by cheque/)

    // cheque details are dropped when the method is not Cheque
    const cash = await api.post('/api/sales').send(sale({ payMethod: 'Cash', paidOnInvoice: 400, chequeDate: past }))
    expect(cash.status).toBe(201)
    expect((await api.get(`/api/sales/${cash.body.id}`)).body).toMatchObject({ chequeNo: '', chequeDate: null })

    for (const id of [res.body.id, paidRes.body.id, cash.body.id]) expect((await api.delete(`/api/sales/${id}`)).status).toBe(200)
  })
})

describe('purchases and stock safety', () => {
  it('rejects a duplicate supplier invoice number', async () => {
    const sup = (await api.get('/api/suppliers/options')).body[0]
    const res = await api.post('/api/purchases').send({ supplierId: sup.id, invoiceNo: 'hosi005920', orderNo: '', salesPerson: '', date: today, payMethod: 'Cash', billDiscPct: 8, paidOnInvoice: 0, notes: '', lines: [{ productId: ids.THMN0030, qty: 1, freeQty: 0, unitPrice: 200, discPct: 22 }] })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already entered/)
  })

  it('will not delete a purchase whose goods were already sold', async () => {
    const list = (await api.get('/api/purchases?search=HOSI005967')).body
    const res = await api.delete(`/api/purchases/${list.items[0].id}`)
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/^Cannot delete HOSI005967 — items from it are already used \(sold or adjusted\): .*PJD-\d{6}/)
    expect(res.body.error).toMatch(/Delete or edit those sales or adjustments first/)
  })

  it('delete / edit guard: refused while sold, nothing changes; allowed once stock is back', async () => {
    const sup = (await api.get('/api/suppliers/options')).body[0]
    const prod = await api.post('/api/products').send({ code: '', name: 'GUARD TEST OIL', size: '30ML', category: 'Thailaya (Oil)', listPrice: 100, supplierDiscPct: 0, sellPrice: 150, reorderLevel: 0, openingStock: 0, active: true })
    const pid = prod.body.id
    const grn = (no: string, qty: number) => api.post('/api/purchases').send({ supplierId: sup.id, invoiceNo: no, orderNo: '', salesPerson: '', date: today, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [{ productId: pid, qty, freeQty: 0, unitPrice: 100, discPct: 0 }] })
    const onHand = async () => (await api.get(`/api/products/${pid}`)).body.product.onHand
    const a = await grn('GUARD-A', 10)
    const sale = await api.post('/api/sales').send({ date: today, customerId: ids.shop, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [{ productId: pid, qty: 6, freeQty: 0, unitPrice: 150, discPct: 0 }] })
    expect(sale.status).toBe(201)
    expect(await onHand()).toBe(4)

    // delete refused: 6 of its 10 are sold
    const del = await api.delete(`/api/purchases/${a.body.id}`)
    expect(del.status).toBe(409)
    expect(del.body.error).toBe(`Cannot delete GUARD-A — items from it are already used (sold or adjusted): 30ML GUARD TEST OIL (6 of 10 used — ${sale.body.invoiceNo}). Delete or edit those sales or adjustments first.`)
    const usage = (await api.get(`/api/purchases/${a.body.id}/usage`)).body
    expect(usage).toMatchObject({ used: true, items: [{ productId: pid, received: 10, used: 6, usedBy: [{ kind: 'sale', id: sale.body.id, ref: sale.body.invoiceNo, qty: 6 }] }] })

    // restocking does NOT make it deletable: the sale still came out of GUARD-A (oldest stock first)
    const b = await grn('GUARD-B', 10)
    expect(await onHand()).toBe(14)
    expect((await api.delete(`/api/purchases/${a.body.id}`)).status).toBe(409)
    // the newer invoice was not touched by any sale → can be deleted
    expect((await api.get(`/api/purchases/${b.body.id}/usage`)).body.used).toBe(false)
    expect((await api.delete(`/api/purchases/${b.body.id}`)).status).toBe(200)
    expect(await onHand()).toBe(4)
    // edit down to 3 refused too (6 sold)
    const edit = await api.put(`/api/purchases/${a.body.id}`).send({ supplierId: sup.id, invoiceNo: 'GUARD-A', orderNo: '', salesPerson: '', date: today, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [{ productId: pid, qty: 3, freeQty: 0, unitPrice: 100, discPct: 0 }] })
    expect(edit.status).toBe(409)
    expect(edit.body.error).toMatch(/^Cannot reduce these items on GUARD-A — .*6 of 10 used/)
    // …and nothing changed
    expect(await onHand()).toBe(4)
    expect((await api.get(`/api/purchases/${a.body.id}`)).body.lines[0].qty).toBe(10)
    // edit down to 6 is fine (exactly what was sold)
    const edit6 = await api.put(`/api/purchases/${a.body.id}`).send({ supplierId: sup.id, invoiceNo: 'GUARD-A', orderNo: '', salesPerson: '', date: today, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [{ productId: pid, qty: 6, freeQty: 0, unitPrice: 100, discPct: 0 }] })
    expect(edit6.status).toBe(200)
    expect(await onHand()).toBe(0)

    // once the sale is deleted, the goods are back and the purchase can be deleted
    expect((await api.delete(`/api/sales/${sale.body.id}`)).status).toBe(200)
    expect(await onHand()).toBe(6)
    expect((await api.delete(`/api/purchases/${a.body.id}`)).status).toBe(200)
    expect(await onHand()).toBe(0)
    expect((await api.delete(`/api/products/${pid}`)).status).toBe(200)
  })

  it('adjustments cannot take stock below zero; deleting reverses them', async () => {
    const tooMany = await api.post('/api/adjustments').send({ date: today, productId: ids.TBTR1000, qty: -2, reason: 'Damage', notes: '' })
    expect(tooMany.status).toBe(409)
    const ok = await api.post('/api/adjustments').send({ date: today, productId: ids.TBTR1000, qty: -1, reason: 'Expired', notes: 'box damp' })
    expect(ok.status).toBe(201)
    expect((await product('TBTR1000')).onHand).toBe(0)
    expect((await api.delete(`/api/adjustments/${ok.body.id}`)).status).toBe(200)
    expect((await product('TBTR1000')).onHand).toBe(1)
  })

  it('records an exchange with another distributor as stock out and stock in', async () => {
    const before = (await product('ATCS0030')).onHand
    const out = await api.post('/api/adjustments').send({ date: today, productId: ids.ATCS0030, qty: -3, reason: 'Exchange with distributor', notes: 'Given to Nimal Osu' })
    expect(out.status).toBe(201)
    const back = await api.post('/api/adjustments').send({ date: today, productId: ids.ATGL0030, qty: 2, reason: 'Exchange with distributor', notes: 'Received from Nimal Osu' })
    expect(back.status).toBe(201)
    expect((await product('ATCS0030')).onHand).toBe(before - 3)
    const list = (await api.get('/api/adjustments?reason=Exchange%20with%20distributor&pageSize=50')).body
    expect(list.items.map((a: { id: number }) => a.id).sort()).toEqual([out.body.id, back.body.id].sort())
    expect((await api.get('/api/adjustments?reason=Damage&pageSize=50')).body.items.map((a: { id: number }) => a.id)).not.toContain(out.body.id)
    const moves = (await api.get(`/api/products/${ids.ATGL0030}/movements`)).body.items
    expect(moves[0]).toMatchObject({ type: 'Adjustment', ref: 'Exchange with distributor', party: 'Received from Nimal Osu', qtyIn: 2 })
    for (const id of [out.body.id, back.body.id]) expect((await api.delete(`/api/adjustments/${id}`)).status).toBe(200)
    expect((await product('ATCS0030')).onHand).toBe(before)
  })

  it('allows negative stock only when switched on in settings', async () => {
    const s = (await api.get('/api/settings')).body
    await api.put('/api/settings').send({ ...s, allowNegativeStock: true })
    const res = await api.post('/api/adjustments').send({ date: today, productId: ids.TBTR1000, qty: -3, reason: 'Other', notes: '' })
    expect(res.status).toBe(201)
    expect((await product('TBTR1000')).onHand).toBe(-2)
    await api.delete(`/api/adjustments/${res.body.id}`)
    await api.put('/api/settings').send({ ...s, allowNegativeStock: false })
  })

  it('blocks deleting things that are in use', async () => {
    expect((await api.delete(`/api/products/${ids.THMN0030}`)).status).toBe(409)
    expect((await api.delete(`/api/customers/${ids.shop}`)).status).toBe(409)
    expect((await api.delete(`/api/customer-types/${ids['type:SHOP']}`)).status).toBe(409)
  })

  it('cannot lower opening stock below what was already sold', async () => {
    const p = (await api.get(`/api/products/${ids.ATGN0030}`)).body.product
    // ATGN0030 had 273 in, sold 15 → raise opening by 5 is fine
    const up = await api.put(`/api/products/${p.id}`).send({ ...p, openingStock: 5 })
    expect(up.status).toBe(200)
    const s = (await product('ATGN0030'))
    expect(s.onHand).toBe(273 - 15 + 5)
    await api.put(`/api/products/${p.id}`).send({ ...p, openingStock: 0 })
  })
})

describe('lists, pagination and reports', () => {
  it('paginates and sorts products', async () => {
    const p1 = (await api.get('/api/products?pageSize=10&page=1&sort=code&dir=asc')).body
    const p6 = (await api.get('/api/products?pageSize=10&page=6&sort=code&dir=asc')).body
    expect(p1.total).toBe(53)
    expect(p1.items).toHaveLength(10)
    expect(p6.items).toHaveLength(3)
    expect(p1.items[0].code <= p1.items[1].code).toBe(true)
    const beyond = (await api.get('/api/products?pageSize=10&page=99')).body
    expect(beyond.page).toBe(6) // clamps to last page
  })

  it('report totals agree with invoices', async () => {
    const sales = (await api.get(`/api/sales?pageSize=200`)).body
    const from = addDays(today, -90)
    const s = (await api.get(`/api/reports/summary?from=${from}&to=${today}`)).body
    const returns = (await api.get(`/api/sales-returns?from=${from}&to=${today}&pageSize=200`)).body
    const returnedCost = returns.items.reduce((a: number, r: { costTotal: number }) => a + r.costTotal, 0)
    expect(s.invoices).toBe(sales.total)
    expect(s.revenue).toBeCloseTo(sales.summary.netTotal - returns.summary.netTotal, 2) // sales less returns
    expect(s.profit).toBeCloseTo(sales.summary.profit - returns.summary.netTotal + returnedCost, 2)
    const byType = (await api.get(`/api/reports/by-type?from=${from}&to=${today}`)).body
    expect(byType.reduce((a: number, t: { revenue: number }) => a + t.revenue, 0)).toBeCloseTo(s.revenue, 2)
  })

  it('the sales list shows the discount margin: discount given less the supplier item discount (22%)', async () => {
    const list = (await api.get('/api/sales?pageSize=200')).body
    const opts = (await api.get('/api/products/options')).body as { id: number; supplierDiscPct: number }[]
    const disc = new Map(opts.map((p) => [p.id, p.supplierDiscPct]))
    expect(list.items.length).toBeGreaterThan(2)
    for (const row of list.items.slice(0, 6)) {
      const inv = (await api.get(`/api/sales/${row.id}`)).body
      const item = inv.lines.reduce((s: number, l: { qty: number; unitPrice: number; productId: number }) => s + (l.qty * l.unitPrice * (disc.get(l.productId) ?? 0)) / 100, 0)
      expect(row.gross).toBe(inv.gross)
      expect(row.itemDiscount).toBeCloseTo(item, 2)
      expect(row.discountGiven).toBeCloseTo(inv.gross - inv.netTotal, 2)
      expect(row.discountMargin).toBeCloseTo(inv.gross - inv.netTotal - item, 2)
    }
    expect(list.summary.discountMargin).toBeCloseTo(list.items.reduce((s: number, r: { discountMargin: number }) => s + r.discountMargin, 0), 2)
    expect(list.summary.discountGiven).toBeCloseTo(list.summary.gross - list.summary.netTotal, 2)
  })

  it('the sales list carries the supplier bill discount (8% of the goods after 22%) from the newest GRN', async () => {
    const list = (await api.get('/api/sales?pageSize=200')).body
    const newest = (await api.get('/api/purchases?pageSize=1&sort=date&dir=desc')).body.items[0]
    expect(newest.billDiscPct).toBeGreaterThan(0)
    expect(list.summary.supplierBillDiscPct).toBe(newest.billDiscPct)
    for (const row of list.items) {
      expect(row.supplierBillDiscPct).toBe(newest.billDiscPct)
      expect(row.supplierBillDiscount).toBeCloseTo(((row.gross - row.itemDiscount) * newest.billDiscPct) / 100, 2)
    }
    expect(list.summary.supplierBillDiscount).toBeCloseTo(list.items.reduce((s: number, r: { supplierBillDiscount: number }) => s + r.supplierBillDiscount, 0), 2)
  })

  it('returns 404 / 400 for bad ids', async () => {
    expect((await api.get('/api/sales/999999')).status).toBe(404)
    expect((await api.get('/api/sales/abc')).status).toBe(400)
  })
})

describe('password login', () => {
  it('locks the API when APP_PASSWORD is set', async () => {
    process.env.APP_PASSWORD = 'secret-123'
    try {
      expect((await api.get('/api/health')).status).toBe(200)
      expect((await api.get('/api/products')).status).toBe(401)
      expect((await api.get('/api/auth/me')).body).toEqual({ required: true, loggedIn: false })
      expect((await api.post('/api/auth/login').send({ password: 'nope' })).status).toBe(401)
      const ok = await api.post('/api/auth/login').send({ password: 'secret-123' })
      expect(ok.status).toBe(200)
      const auth = { Authorization: `Bearer ${ok.body.token}` }
      expect((await api.get('/api/products').set(auth)).status).toBe(200)
      expect((await api.get('/api/auth/me').set(auth)).body.loggedIn).toBe(true)
      expect((await api.get('/api/products').set({ Authorization: `Bearer ${ok.body.token}x` })).status).toBe(401)
      // invoice photos: <img> cannot send a header — the token in the link (?t=) works, but only for photo files
      const p = (await api.get('/api/purchases?pageSize=1').set(auth)).body.items[0]
      const img = await api.post(`/api/purchases/${p.id}/images`).set(auth).send({ mimeType: 'image/jpeg', data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 'x')]).toString('base64'), thumb: Buffer.from('t'.repeat(80)).toString('base64'), sha256: 'a'.repeat(64), width: 10, height: 10 })
      expect(img.status).toBe(201)
      expect((await api.get(`/api/images/${img.body.id}/file`)).status).toBe(401)
      // … but only the short-lived read-only image token works there, never the session token itself
      expect(ok.body.imageToken).toBeTruthy()
      expect((await api.get(`/api/images/${img.body.id}/file?t=${encodeURIComponent(ok.body.token)}`)).status).toBe(401)
      expect((await api.get(`/api/images/${img.body.id}/file?t=${encodeURIComponent(ok.body.imageToken)}`)).status).toBe(200)
      expect((await api.get(`/api/images/${img.body.id}/file?size=thumb&t=${encodeURIComponent(ok.body.imageToken)}`)).status).toBe(200)
      expect((await api.get(`/api/products?t=${encodeURIComponent(ok.body.imageToken)}`)).status).toBe(401) // not for other pages
      expect((await api.get('/api/products').set({ Authorization: `Bearer ${ok.body.imageToken}` })).status).toBe(401) // nor as a session
      expect((await api.get('/api/auth/me').set(auth)).body.imageToken).toBeTruthy()
      expect((await api.delete(`/api/images/${img.body.id}`).set(auth)).status).toBe(200)
      process.env.APP_PASSWORD = 'changed'
      expect((await api.get('/api/products').set(auth)).status).toBe(401) // changing the password logs everyone out
    } finally {
      delete process.env.APP_PASSWORD
      _resetAuthLimits()
    }
  }, 30_000)

  it('locks login for a while after too many wrong passwords', async () => {
    process.env.APP_PASSWORD = 'secret-123'
    try {
      _resetAuthLimits()
      for (let i = 0; i < 10; i++) expect((await api.post('/api/auth/login').send({ password: `wrong-${i}` })).status).toBe(401)
      const blocked = await api.post('/api/auth/login').send({ password: 'secret-123' }) // even the right password waits now
      expect(blocked.status).toBe(429)
      expect(blocked.headers['retry-after']).toBeTruthy()
      _resetAuthLimits()
      expect((await api.post('/api/auth/login').send({ password: 'secret-123' })).status).toBe(200)
    } finally {
      delete process.env.APP_PASSWORD
      _resetAuthLimits()
    }
  }, 30_000)

  it('rejects an oversized body with 413, not a generic 500', async () => {
    const big = await api.post('/api/products').set('content-type', 'application/json').send(`{"name":"${'x'.repeat(6_500_000)}"}`)
    expect(big.status).toBe(413)
  })
})

describe('automatic item codes', () => {
  it('creates the code from name + size and never duplicates or changes it', async () => {
    const body = { name: 'Siddhalepa Balm', size: '50g', category: 'Lepa / Paste', listPrice: 300, supplierDiscPct: 22, sellPrice: 300, reorderLevel: 5, openingStock: 0, active: true }
    const a = await api.post('/api/products').send(body)
    expect(a.status).toBe(201)
    expect(a.body.code).toBe('LPSB0050')
    const dup = await api.post('/api/products').send({ ...body, code: '' })
    expect(dup.status).toBe(409) // same name + size is the same product
    const b = await api.post('/api/products').send({ ...body, code: '', name: 'Sudu Balm' }) // different product, same initials → same code, suffixed
    expect(b.body.code).toBe('LPSB0050-2')
    const edit = await api.put(`/api/products/${a.body.id}`).send({ ...a.body, code: 'HACKED', name: 'SIDDHALEPA BALM' })
    expect(edit.status).toBe(200)
    expect(edit.body.code).toBe('LPSB0050')
  })
})

describe('dashboard', () => {
  it('returns 30 days, trends and who to collect from', async () => {
    const d = (await api.get('/api/dashboard')).body
    expect(d.last30).toHaveLength(30)
    expect(d.last30.at(-1).date).toBe(today)
    const todaySales = (await api.get(`/api/sales?from=${today}&to=${today}&pageSize=200`)).body
    const todayReturns = (await api.get(`/api/sales-returns?from=${today}&to=${today}&pageSize=200`)).body
    const net = todaySales.summary.netTotal - todayReturns.summary.netTotal
    expect(d.today.revenue).toBeCloseTo(net, 2)
    expect(d.last30.at(-1).revenue).toBeCloseTo(net, 2)
    expect(d.toCollect[0].overdue).toBeGreaterThanOrEqual(d.toCollect.at(-1).overdue)
    expect(typeof d.month.lastMonthSameDays).toBe('number')
  })
})

describe('stock amount = unit price − discount, free items at 0', () => {
  it('values paid units only, after 22% line + 8% bill discount', async () => {
    const p = await product('THMN0030') // bought 120 + 10 free; sold 24 + 2 free in the sales tests
    expect(p).toMatchObject({ freeIn: 10, freeOut: 2, freeOnHand: 8, onHand: 104, paidOnHand: 96, lineDiscPct: 22, billDiscPct: 8 })
    expect(p.grossValue).toBe(96 * 200)
    expect(p.stockValue).toBeCloseTo(96 * 200 * 0.78 * 0.92, 2)
    expect(p.discountValue).toBeCloseTo(p.grossValue - p.stockValue, 2)
    const all = (await api.get('/api/products?pageSize=200')).body
    expect(all.summary.costValue).toBeCloseTo(all.summary.grossValue - all.summary.discountValue, 1)
  })

  it('a refill with different discounts keeps its own price/discounts (FIFO)', async () => {
    const sup = (await api.get('/api/suppliers/options')).body.find((s: { lastBillDiscPct: number | null }) => s.lastBillDiscPct != null)
    expect(sup.lastBillDiscPct).toBe(8)
    const grn = await api.post('/api/purchases').send({
      supplierId: sup.id, invoiceNo: 'REFILL-1', orderNo: '', salesPerson: '', date: today, payMethod: 'Cash', billDiscPct: 5, paidOnInvoice: 0, notes: '',
      lines: [{ productId: ids.THMN0030, qty: 50, freeQty: 5, unitPrice: 210, discPct: 20 }],
    })
    expect(grn.status).toBe(201)
    const p = await product('THMN0030')
    expect(p).toMatchObject({ paidOnHand: 146, freeOnHand: 13, mixedDisc: true, lineDiscPct: 20, billDiscPct: 5, listPrice: 210, supplierDiscPct: 20 })
    expect(p.batches[0]).toMatchObject({ invoiceNo: 'REFILL-1', qty: 50, freeQty: 5, unitPrice: 210, amount: 10500 })
    expect(p.batches[0].stockAmount).toBeCloseTo(10500 * 0.8 * 0.95, 2)
    expect(p.batches[1]).toMatchObject({ qty: 96, freeQty: 8, unitPrice: 200, lineDiscPct: 22, billDiscPct: 8 })
    expect(p.grossValue).toBe(10500 + 96 * 200)
    expect(p.stockValue).toBeCloseTo(10500 * 0.8 * 0.95 + 96 * 200 * 0.78 * 0.92, 1)
    const opts = (await api.get('/api/suppliers/options')).body.find((s: { id: number }) => s.id === sup.id)
    expect(opts.lastBillDiscPct).toBe(5)

    // selling takes the oldest stock first: 100 sold → 96 old + 4 from the refill, 46 of the refill left
    const sale = await api.post('/api/sales').send({ date: today, customerId: ids.shop, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [{ productId: ids.THMN0030, qty: 100, freeQty: 0, unitPrice: 200, discPct: 0 }] })
    expect(sale.status).toBe(201)
    const after = await product('THMN0030')
    expect(after.paidOnHand).toBe(46)
    expect(after.mixedDisc).toBe(false)
    expect(after.stockValue).toBeCloseTo(46 * 210 * 0.8 * 0.95, 2)
    await api.delete(`/api/sales/${sale.body.id}`)
    await api.delete(`/api/purchases/${grn.body.id}`)
    expect(await product('THMN0030')).toMatchObject({ listPrice: 200, supplierDiscPct: 22, paidOnHand: 96 })
  })
})

describe('scan invoice image → draft (nothing saved until confirmed)', () => {
  const file = { kind: 'purchase', mimeType: 'image/jpeg', data: 'x'.repeat(200) }

  it('without an API key the AI reader is off (the browser reads offline instead)', async () => {
    expect((await api.get('/api/scan-invoice/status')).body).toEqual({ enabled: true, ai: false })
    const res = await api.post('/api/scan-invoice').send(file)
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/SCAN_API_KEY/)
  })

  it('matches products by code, AI id or name+size, the supplier by name, and flags problems', async () => {
    let seen: { catalog: number; parties: number } | null = null
    const raw: RawScan = {
      invoiceNo: 'HOSI005920', // already entered → duplicate warning
      date: '2026-10-05',
      partyName: 'Pasyale Ayurveda Osu Pvt Ltd',
      billDiscPct: 8,
      printedNetTotal: 99999,
      lines: [
        { code: 'thmn0030', description: 'MAHA NARAYANA THEL', size: '30ML', qty: 12, freeQty: 1, unitPrice: 200, discPct: 22, lineTotal: 1872 },
        { productId: ids.ATAB0030, description: 'ABA THEL', size: '30 ml', qty: 6, freeQty: 0, unitPrice: 200, discPct: 22, lineTotal: 936 },
        { description: 'Kohomba Thel', size: '30ML', qty: 3, unitPrice: 200, discPct: 22, lineTotal: 500 },
        { description: 'Unknown Oil', size: '30ML', qty: 2, unitPrice: 100 },
      ],
    }
    const scanApi = request(createApp(database.db, {
      scanner: async ({ catalog, parties }) => {
        seen = { catalog: catalog.length, parties: parties.length }
        return raw
      },
    }))
    const res = await scanApi.post('/api/scan-invoice').send(file)
    expect(res.status).toBe(200)
    expect(seen!.catalog).toBeGreaterThan(40)
    const r = res.body
    expect(r.partyId).toBeTruthy()
    expect(r.lines.map((l: { productId: number | null; matchedBy: string | null }) => [l.productId, l.matchedBy])).toEqual([
      [ids.THMN0030, 'code'], [ids.ATAB0030, 'ai'], [ids.ATNE0030, 'name'], [null, null],
    ])
    expect(r.lines[0]).toMatchObject({ qty: 12, freeQty: 1, unitPrice: 200, discPct: 22 })
    const w = r.warnings.join('\n')
    expect(w).toMatch(/already entered/)
    expect(w).toMatch(/Unknown Oil.*not found/)
    expect(w).toMatch(/Line 3 .*invoice shows 500/)
    expect(w).toMatch(/invoice shows Rs 99999.00/)

    // nothing was saved by scanning
    expect((await api.get('/api/purchases?pageSize=50')).body.total).toBe(5)
  })

  it('offline path: checks lines the browser read, and saves nothing', async () => {
    const res = await api.post('/api/scan-invoice/parse').send({
      kind: 'purchase',
      raw: { invoiceNo: 'HOS1006300', date: '2026-10-13', partyName: '???', billDiscPct: null, lines: [{ productId: ids.ATAB0030, size: '300ML', qty: 12, freeQty: 1, unitPrice: 200, discPct: 22, lineTotal: 1872 }] },
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ invoiceNo: 'HOSI006300', billDiscPct: 8 })
    expect(res.body.partyId).toBeTruthy() // the only supplier
    expect(res.body.lines[0]).toMatchObject({ productId: ids.ATAB0030, qty: 12, freeQty: 1 })
    expect((await api.get('/api/purchases?pageSize=50')).body.total).toBe(5)
  })

  it('rejects files that are too large or the wrong type', async () => {
    const scanApi = request(createApp(database.db, { scanner: async () => ({ lines: [] }) }))
    expect((await scanApi.post('/api/scan-invoice').send({ ...file, mimeType: 'text/plain' })).status).toBe(400)
  })
})

describe('invoice photos', () => {
  // the server checks the first bytes (JPEG / PNG / WebP signature) and stores the rest as given
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
  const photo = (seed: string) => {
    const bytes = Buffer.concat([JPEG, Buffer.from(`fake-jpeg-${seed}-`.repeat(40))])
    return { mimeType: 'image/jpeg', data: bytes.toString('base64'), thumb: Buffer.from(`thumb-${seed}`.repeat(10)).toString('base64'), sha256: createHash('sha256').update(seed).digest('hex'), width: 1800, height: 2400 }
  }
  const files = () => readdirSync(uploadDir, { recursive: true }).filter((f) => String(f).match(/\.(jpg|png|webp)$/))

  it('stores the real image type and refuses files that are not images', async () => {
    const p = (await api.get('/api/purchases?search=HOSI005942')).body.items[0]
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)])
    const asJpeg = await api.post(`/api/purchases/${p.id}/images`).send({ ...photo('png-as-jpeg'), data: png.toString('base64') })
    expect(asJpeg.status).toBe(201)
    expect((await api.get(`/api/images/${asJpeg.body.id}/file`)).headers['content-type']).toMatch(/image\/png/) // served as what it really is
    expect((await api.delete(`/api/images/${asJpeg.body.id}`)).status).toBe(200)
    const junk = await api.post(`/api/purchases/${p.id}/images`).send({ ...photo('junk'), data: Buffer.from('<html>not an image</html>'.repeat(20)).toString('base64') })
    expect(junk.status).toBe(400)
  })

  it('attaches photos to a purchase, serves them, numbers the pages', async () => {
    const p = (await api.get('/api/purchases?search=HOSI005920')).body.items[0]
    expect(p.imageCount).toBe(0)
    const a = await api.post(`/api/purchases/${p.id}/images`).send(photo('5920-page1'))
    expect(a.status).toBe(201)
    expect(a.body).toMatchObject({ kind: 'purchase', invoiceId: p.id, invoiceNo: 'HOSI005920', page: 1 })
    const b = await api.post(`/api/purchases/${p.id}/images`).send(photo('5920-page2'))
    expect(b.body.page).toBe(2)
    const file = await api.get(`/api/images/${a.body.id}/file`).buffer(true)
    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('image/jpeg')
    expect(file.headers['content-disposition']).toMatch(/HOSI005920-p1\.jpg/)
    expect(Buffer.from(file.body).toString()).toContain('fake-jpeg-5920-page1')
    expect((await api.get(`/api/images/${a.body.id}/file?size=thumb`)).status).toBe(200)
    expect((await api.get(`/api/purchases/${p.id}/images`)).body.map((i: { page: number }) => i.page)).toEqual([1, 2])
    expect((await api.get('/api/purchases?search=HOSI005920')).body.items[0].imageCount).toBe(2)
    // remove page 1 → page 2 becomes page 1, file gone from disk
    const before = files().length
    expect((await api.delete(`/api/images/${a.body.id}`)).status).toBe(200)
    expect((await api.get(`/api/purchases/${p.id}/images`)).body).toMatchObject([{ id: b.body.id, page: 1 }])
    expect(files().length).toBe(before - 2) // photo + small preview
  })

  it('the same photo cannot be attached to two invoices', async () => {
    const other = (await api.get('/api/purchases?search=HOSI005927')).body.items[0]
    const res = await api.post(`/api/purchases/${other.id}/images`).send(photo('5920-page2'))
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already attached to purchase invoice HOSI005920 \(page 1\)/)
    const sale = (await api.get('/api/sales?pageSize=1')).body.items[0]
    expect((await api.post(`/api/sales/${sale.id}/images`).send(photo('5920-page2'))).status).toBe(409)
  })

  it('lists invoices without photos, gallery search, photos removed with the invoice', async () => {
    const none = (await api.get('/api/purchases?images=none&pageSize=50')).body.items.map((i: { invoiceNo: string }) => i.invoiceNo)
    expect(none).not.toContain('HOSI005920')
    expect((await api.get('/api/purchases?images=has')).body.items.map((i: { invoiceNo: string }) => i.invoiceNo)).toEqual(['HOSI005920'])
    const sup = (await api.get('/api/suppliers/options')).body[0]
    const grn = await api.post('/api/purchases').send({ supplierId: sup.id, invoiceNo: 'PHOTO-1', orderNo: '', salesPerson: '', date: today, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [{ productId: ids.ATAB0030, qty: 1, freeQty: 0, unitPrice: 200, discPct: 0 }] })
    await api.post(`/api/purchases/${grn.body.id}/images`).send(photo('photo-1'))
    const gallery = (await api.get('/api/images?search=PHOTO-1')).body
    expect(gallery.items).toMatchObject([{ invoiceNo: 'PHOTO-1', kind: 'purchase', partyName: sup.name }])
    const before = files().length
    expect((await api.delete(`/api/purchases/${grn.body.id}`)).status).toBe(200)
    expect(files().length).toBe(before - 2) // photo + small preview
    expect((await api.get('/api/images?search=PHOTO-1')).body.total).toBe(0)
    expect(existsSync(uploadDir)).toBe(true)
  })
})

describe('Products → Scan: import new products and price changes', () => {
  it('adds new products (supplier code kept) and updates prices together', async () => {
    const before = await product('ATAB0030')
    const res = await api.post('/api/products/import').send({
      create: [{ code: 'CHTP0050', name: 'triphala choorna', size: '50g', category: 'Choorna / Powder', listPrice: 380, supplierDiscPct: 22, sellPrice: 380, reorderLevel: 5, openingStock: 0, active: true }],
      update: [{ id: before.id, listPrice: 210, supplierDiscPct: 22, sellPrice: 210 }],
    })
    expect(res.status).toBe(201)
    expect(res.body.created).toMatchObject([{ code: 'CHTP0050', name: 'TRIPHALA CHOORNA', size: '50g', listPrice: 380 }])
    expect(res.body.updated).toBe(1)
    expect(await product('ATAB0030')).toMatchObject({ listPrice: 210, sellPrice: 210, onHand: before.onHand })
    // the same new product twice → refused, nothing saved
    const again = await api.post('/api/products/import').send({
      create: [{ code: '', name: 'TRIPHALA CHOORNA', size: '50g', category: 'Choorna / Powder', listPrice: 380, supplierDiscPct: 22, sellPrice: 380, reorderLevel: 5, openingStock: 0, active: true }],
      update: [{ id: before.id, listPrice: 999, supplierDiscPct: 22 }],
    })
    expect(again.status).toBe(409)
    expect(again.body.error).toMatch(/already exists \(CHTP0050\)/)
    expect((await product('ATAB0030')).listPrice).toBe(210)
    // put things back for other tests
    await api.post('/api/products/import').send({ update: [{ id: before.id, listPrice: before.listPrice, supplierDiscPct: before.supplierDiscPct, sellPrice: before.sellPrice }] })
    expect((await api.delete(`/api/products/${res.body.created[0].id}`)).status).toBe(200)
  })
})

describe('UAT fixes: suppliers, products, dates, messages', () => {
  const product = { code: '', name: 'Uat Fix Oil', size: '30ML', category: 'Other', listPrice: 100, supplierDiscPct: 0, sellPrice: 120, reorderLevel: 0, openingStock: 0, active: true }

  it('refuses an inactive supplier on a new GRN', async () => {
    const s = await api.post('/api/suppliers').send({ code: 'SUP-INACT', name: 'Closed Supplier', phone: '', address: '', creditDays: 0, notes: '', active: false })
    expect(s.status).toBe(201)
    const p = (await api.get('/api/products/options')).body[0]
    const g = await api.post('/api/purchases').send({ date: '2026-10-20', payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', supplierId: s.body.id, invoiceNo: 'INACT-1', orderNo: '', salesPerson: '', lines: [{ productId: p.id, qty: 1, freeQty: 0, unitPrice: 100, discPct: 0 }] })
    expect(g.status).toBe(400)
    expect(g.body.error).toMatch(/inactive/)
  })

  it('a typed item code that is already used is refused, not renamed', async () => {
    const first = (await api.get('/api/products/options')).body[0]
    const r = await api.post('/api/products').send({ ...product, code: first.code, name: 'Code Clash' })
    expect(r.status).toBe(409)
    expect(r.body.error).toContain(first.code)
  })

  it('normalises sizes, so "30 ml" and "30ML" are one variant, and refuses the duplicate', async () => {
    const a = await api.post('/api/products').send({ ...product, size: '30 ml' })
    expect(a.status).toBe(201)
    expect(a.body.size).toBe('30ML')
    expect((await api.post('/api/products').send({ ...product, size: '30ML' })).status).toBe(409)
    const c = await api.post('/api/products').send({ ...product, name: 'Uat Fix Powder', size: '100 G' })
    expect(c.body.size).toBe('100g')
    const renamed = await api.put(`/api/products/${c.body.id}`).send({ ...c.body, name: 'UAT FIX OIL', size: '30ML' })
    expect(renamed.status).toBe(409) // editing into an existing name + size is refused too
  })

  it('impossible dates are a 400, not a 500', async () => {
    const p = (await api.get('/api/products/options')).body[0]
    for (const date of ['2026-02-31', '2026-13-01']) {
      const r = await api.post('/api/adjustments').send({ date, productId: p.id, qty: 1, reason: 'Other', notes: '' })
      expect(r.status).toBe(400)
      expect(r.body.error).toMatch(/date/i)
    }
  })

  it('404 for deleting a missing promotion or listing movements of a missing product', async () => {
    expect((await api.delete('/api/promotions/999999')).status).toBe(404)
    expect((await api.get('/api/products/999999/movements')).status).toBe(404)
  })

  it('explains wrongly typed or missing fields in plain words', async () => {
    const r = await api.get('/api/products?page=abc')
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('Page must be a number')
    const missing = await api.post('/api/products').send({ ...product, size: undefined })
    expect(missing.body.error).toBe('Size is required')
  })

  it('a fixed price rule of 0 is refused', async () => {
    const p = (await api.get('/api/products/options')).body[0]
    const types = (await api.get('/api/customer-types')).body
    const r = await api.put('/api/price-rules').send({ rules: [{ productId: p.id, customerTypeId: types[0].id, price: 0, discPct: null }] })
    expect(r.status).toBe(400)
  })
})

describe('UAT fixes: customers, payments, rounding', () => {
  it('customer codes are case-insensitive (stored upper-case)', async () => {
    const types = (await api.get('/api/customer-types')).body
    const a = await api.post('/api/customers').send({ code: 'case-1', name: 'Case One', typeId: types[0].id, phone: '', address: '', area: '', discPct: null, creditLimit: 0, creditDays: null, notes: '', active: true })
    expect(a.status).toBe(201)
    expect(a.body.code).toBe('CASE-1')
    expect((await api.post('/api/customers').send({ code: 'CASE-1', name: 'Case Two', typeId: types[0].id, phone: '', address: '', area: '', discPct: null, creditLimit: 0, creditDays: null, notes: '', active: true })).status).toBe(409)
  })

  it('a cheque payment needs the cheque number; deleting a missing customer type is a 404', async () => {
    const c = (await api.get('/api/customers?pageSize=1')).body.items[0]
    const r = await api.post('/api/payments').send({ date: '2026-10-20', partyType: 'customer', partyId: c.id, amount: 10, method: 'Cheque', reference: '', notes: '' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/cheque number/i)
    expect((await api.delete('/api/customer-types/999999')).status).toBe(404)
  })

  it('prices and discounts are rounded to cents before saving, so the ledger and the printed invoice agree', async () => {
    const c = (await api.get('/api/customers?pageSize=1')).body.items[0]
    const p = (await api.get('/api/products/options')).body.find((x: { onHand: number }) => x.onHand > 10)
    const r = await api.post('/api/sales').send({ date: '2026-10-20', payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', customerId: c.id, lines: [{ productId: p.id, qty: 3, freeQty: 0, unitPrice: 1.005, discPct: 0 }] })
    expect(r.status).toBe(201)
    const inv = (await api.get(`/api/sales/${r.body.id}`)).body
    expect(inv.lines[0].unitPrice).toBe(1.01)
    expect(inv.netTotal).toBe(3.03) // 3 × 1.01, the same figure the printed document recomputes
    expect((await api.delete(`/api/sales/${r.body.id}`)).status).toBe(200)
  })
})

describe('scanning key is separate from the assistant key', () => {
  it('ANTHROPIC_API_KEY alone leaves AI scanning off; SCAN_API_KEY turns it on', async () => {
    const prev = { a: process.env.ANTHROPIC_API_KEY, s: process.env.SCAN_API_KEY }
    try {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-assistant-only'
      delete process.env.SCAN_API_KEY
      expect((await request(createApp(database.db)).get('/api/scan-invoice/status')).body).toEqual({ enabled: true, ai: false })
      process.env.SCAN_API_KEY = 'sk-ant-scan-key'
      expect((await request(createApp(database.db)).get('/api/scan-invoice/status')).body).toEqual({ enabled: true, ai: true })
    } finally {
      if (prev.a === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = prev.a
      if (prev.s === undefined) delete process.env.SCAN_API_KEY
      else process.env.SCAN_API_KEY = prev.s
    }
  })
})
