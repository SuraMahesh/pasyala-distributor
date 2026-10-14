import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { todayLK } from '@pjd/shared'
import { openDatabase, runMigrations, type Database } from './db/client'
import { products, stockAdjustments } from './db/schema'
import { seed } from './db/seed'
import { saveSale } from './services/invoices'
import { assertStockAvailable, stockMap } from './services/stock'
import { eq } from 'drizzle-orm'

// Two people at the same moment: one removes stock (purchase delete / adjustment), one sells the same item.
// Needs a real PostgreSQL server (several connections) — set TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL
describe.skipIf(!url)('stock cannot go below zero even when two changes happen at once', () => {
  let database: Database
  beforeAll(async () => {
    database = await openDatabase(url)
    await database.db.execute(sql`drop schema if exists public cascade`)
    await database.db.execute(sql`drop schema if exists drizzle cascade`)
    await database.db.execute(sql`create schema public`)
    await runMigrations(database)
    await seed(database.db)
  })
  afterAll(async () => database?.close())

  it('a sale waits for a stock removal that is in progress, then is refused', async () => {
    const db = database.db
    const [p] = await db.select().from(products).where(eq(products.code, 'RSDH1000')) // 50 on hand
    const onHand = (await stockMap(db, [p.id])).get(p.id)!.onHand
    expect(onHand).toBe(50)
    const [cust] = (await db.execute(sql`select id from customers limit 1`) as unknown as { rows: { id: number }[] }).rows

    // person A: remove 40 (checks, then takes a moment before writing)
    const removal = db.transaction(async (tx) => {
      await assertStockAvailable(tx, new Map([[p.id, -40]]))
      await new Promise((r) => setTimeout(r, 400))
      await tx.insert(stockAdjustments).values({ date: todayLK(), productId: p.id, qty: -40, reason: 'Damage', notes: 'race test' })
    })
    await new Promise((r) => setTimeout(r, 100))
    // person B: sell 30 while A is still busy
    const sale = saveSale(db, { date: todayLK(), customerId: cust.id, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '', lines: [{ productId: p.id, qty: 30, freeQty: 0, unitPrice: 4500, discPct: 0 }] })
    const [a, b] = await Promise.allSettled([removal, sale])
    expect(a.status).toBe('fulfilled')
    expect(b.status).toBe('rejected')
    expect(String((b as PromiseRejectedResult).reason?.message)).toMatch(/Not enough stock/)
    expect((await stockMap(db, [p.id])).get(p.id)!.onHand).toBe(10)
  })
})
