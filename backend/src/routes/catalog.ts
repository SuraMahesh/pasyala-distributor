import { Router } from 'express'
import { asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  bulkPriceSchema,
  CATEGORIES,
  customerTypeSchema,
  listQuerySchema,
  priceRulesBatchSchema,
  productSchema,
  promotionSchema,
  quotePrice,
  suggestProductCode,
  round2,
  todayLK,
  type Category,
  type CustomerType,
  type Product,
  type ProductWithStock,
  type StockBatch,
} from '@pjd/shared'
import type { DB, Executor } from '../db/client'
import { customers, customerTypes, priceRules, products, promotions } from '../db/schema'
import { conflict, idParam, notFound, parse } from '../errors'
import { paginate, sizeRank } from '../lib/list'
import { assertStockAvailable, productMovements, rows, stockBatches, stockMap } from '../services/stock'

const toProduct = (p: typeof products.$inferSelect): Product => {
  const { createdAt: _c, ...rest } = p
  return { ...rest, category: rest.category as Category }
}

export async function productsWithStock(ex: Executor): Promise<ProductWithStock[]> {
  const list = await ex.select().from(products)
  const stock = await stockMap(ex)
  const batchMap = await stockBatches(ex)
  return list.map((p) => {
    const s = stock.get(p.id)!
    const { label: _l, ...st } = s
    // Stock is valued like the supplier invoices it came from: charged units × unit price, less that GRN's
    // line discount and bill discount. Sales take the oldest stock first (FIFO), so what is on hand is the
    // newest refills — each keeps its own price and discounts. Free units add nothing to the amount.
    const onHand = Math.max(st.onHand, 0)
    const freeOnHand = Math.min(onHand, Math.max(st.freeIn - st.freeOut, 0))
    const paidOnHand = onHand - freeOnHand
    const opening = { invoiceId: null, invoiceNo: 'Opening stock', date: '', qty: p.openingStock, freeQty: 0, unitPrice: p.listPrice, lineDiscPct: p.supplierDiscPct, billDiscPct: 0 }
    const layers = [...(p.openingStock > 0 ? [opening] : []), ...(batchMap.get(p.id) ?? [])].reverse()
    let paidLeft = paidOnHand
    let freeLeft = freeOnHand
    const batches: StockBatch[] = []
    for (const b of layers) {
      if (paidLeft <= 0 && freeLeft <= 0) break
      const qty = Math.min(paidLeft, b.qty)
      const freeQty = Math.min(freeLeft, b.freeQty)
      paidLeft -= qty
      freeLeft -= freeQty
      if (qty || freeQty) batches.push(batchValue(b, qty, freeQty))
    }
    if (paidLeft > 0) {
      // more on hand than all GRNs (stock added by adjustment) — value it like the newest refill
      const ref = layers[0] ?? opening
      const extra = batchValue({ ...ref, invoiceId: null, invoiceNo: 'Stock adjustment', date: '' }, paidLeft, 0)
      batches.push(extra)
    }
    const grossValue = round2(batches.reduce((a, b) => a + b.amount, 0))
    const stockValue = round2(batches.reduce((a, b) => a + b.stockAmount, 0))
    const priced = batches.filter((b) => b.qty > 0)
    const head = priced[0] ?? layers[0] ?? opening
    const mixedDisc = priced.some((b) => b.lineDiscPct !== head.lineDiscPct || b.billDiscPct !== head.billDiscPct || b.unitPrice !== head.unitPrice)
    return {
      ...toProduct(p),
      ...st,
      lineDiscPct: head.lineDiscPct,
      billDiscPct: head.billDiscPct,
      paidOnHand,
      freeOnHand,
      grossValue,
      discountValue: round2(grossValue - stockValue),
      stockValue,
      mixedDisc,
      batches,
      margin: p.sellPrice > 0 ? round2(((p.sellPrice - st.avgCost) / p.sellPrice) * 100) : 0,
    }
  })
}

function batchValue(b: Omit<StockBatch, 'qty' | 'freeQty' | 'amount' | 'stockAmount'>, qty: number, freeQty: number): StockBatch {
  const amount = round2(qty * b.unitPrice)
  const stockAmount = round2(amount * (1 - b.lineDiscPct / 100) * (1 - b.billDiscPct / 100))
  return { invoiceId: b.invoiceId, invoiceNo: b.invoiceNo, date: b.date, qty, freeQty, unitPrice: b.unitPrice, lineDiscPct: b.lineDiscPct, billDiscPct: b.billDiscPct, amount, stockAmount }
}

export async function pricingContext(ex: Executor) {
  const types = await ex.select().from(customerTypes).orderBy(asc(customerTypes.sort), asc(customerTypes.id))
  const rules = await ex.select().from(priceRules)
  const promos = await ex.select().from(promotions)
  return { types: types as CustomerType[], rules, promotions: promos }
}

const productFilters = listQuerySchema.extend({
  category: z.string().default(''),
  size: z.string().default(''),
  status: z.enum(['', 'active', 'inactive']).default(''),
  stock: z.enum(['', 'in', 'low', 'out']).default(''),
})

export function catalogRoutes(db: DB) {
  const r = Router()

  // ---------------- products
  r.get('/products', async (req, res) => {
    const q = productFilters.parse(req.query)
    let list = await productsWithStock(db)
    if (q.category) list = list.filter((p) => p.category === q.category)
    if (q.size) list = list.filter((p) => p.size === q.size)
    if (q.status) list = list.filter((p) => p.active === (q.status === 'active'))
    if (q.stock === 'in') list = list.filter((p) => p.onHand > 0)
    if (q.stock === 'out') list = list.filter((p) => p.onHand <= 0)
    if (q.stock === 'low') list = list.filter((p) => p.onHand > 0 && p.onHand <= p.reorderLevel)
    const { filtered, ...page } = paginate(list, q, {
      search: (p) => `${p.code} ${p.size} ${p.name} ${p.category}`,
      sorters: {
        code: (p) => p.code,
        name: (p) => `${p.name} ${String(100000 + sizeRank(p.size)).padStart(8, '0')}`,
        category: (p) => p.category,
        listPrice: (p) => p.listPrice,
        sellPrice: (p) => p.sellPrice,
        avgCost: (p) => p.avgCost,
        margin: (p) => p.margin,
        onHand: (p) => p.onHand,
        stockValue: (p) => p.stockValue,
        grossValue: (p) => p.grossValue,
        freeOnHand: (p) => p.freeOnHand,
        supplierDiscPct: (p) => p.supplierDiscPct,
      },
      defaultSort: { key: 'name', dir: 'asc' },
    })
    const summary = filtered.reduce(
      (s, p) => {
        s.units += Math.max(p.onHand, 0)
        s.paidUnits += p.paidOnHand
        s.freeUnits += p.freeOnHand
        s.grossValue += p.grossValue
        s.discountValue += p.discountValue
        s.costValue += p.stockValue
        s.sellValue += Math.max(p.onHand, 0) * p.sellPrice
        if (p.onHand <= 0) s.out++
        else if (p.onHand <= p.reorderLevel) s.low++
        return s
      },
      { units: 0, paidUnits: 0, freeUnits: 0, grossValue: 0, discountValue: 0, costValue: 0, sellValue: 0, low: 0, out: 0 },
    )
    res.json({ ...page, summary: { ...summary, grossValue: round2(summary.grossValue), discountValue: round2(summary.discountValue), costValue: round2(summary.costValue), sellValue: round2(summary.sellValue) } })
  })

  r.get('/products/options', async (_req, res) => {
    const list = await productsWithStock(db)
    res.json(
      list
        .sort((a, b) => a.name.localeCompare(b.name) || sizeRank(a.size) - sizeRank(b.size))
        .map((p) => ({
          id: p.id, code: p.code, name: p.name, size: p.size, active: p.active,
          sellPrice: p.sellPrice, listPrice: p.listPrice, supplierDiscPct: p.supplierDiscPct,
          onHand: p.onHand, avgCost: p.avgCost,
        })),
    )
  })

  r.get('/products/meta', async (_req, res) => {
    const sizes = await rows<{ size: string }>(db, sql`select distinct size from products`)
    res.json({ categories: CATEGORIES, sizes: sizes.map((s) => s.size).sort((a, b) => sizeRank(a) - sizeRank(b)) })
  })

  r.get('/products/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const p = (await productsWithStock(db)).find((x) => x.id === id)
    if (!p) throw notFound('Product')
    const ctx = await pricingContext(db)
    res.json({
      product: p,
      rules: ctx.rules.filter((x) => x.productId === id),
      promotions: ctx.promotions.filter((x) => x.productId === id),
      prices: ctx.types.map((t) => ({
        type: t,
        quote: quotePrice({ product: p, customer: { typeId: t.id, discPct: null }, ...ctx, qty: 1, date: todayLK() }),
      })),
    })
  })

  r.get('/products/:id/movements', async (req, res) => {
    const id = idParam(req.params.id)
    const q = listQuerySchema.parse(req.query)
    const list = (await productMovements(db, id)).reverse() // newest first
    const { filtered: _f, ...page } = paginate(list, q, {})
    res.json(page)
  })

  r.post('/products', async (req, res) => {
    const input = parse(productSchema, req.body)
    const row = await db.transaction(async (tx) => {
      // item code is created automatically from category + name + size (THMN0030 style)
      const base = input.code || suggestProductCode(input.name, input.size, input.category)
      const taken = new Set((await rows<{ code: string }>(tx, sql`select code from products where code like ${base + '%'}`)).map((r) => r.code))
      let code = base
      for (let n = 2; taken.has(code); n++) code = `${base}-${n}`
      const [created] = await tx.insert(products).values({ ...input, code }).returning()
      return created
    })
    res.status(201).json(toProduct(row))
  })

  r.put('/products/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const input = parse(productSchema, req.body)
    const row = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(products).where(eq(products.id, id)).for('update')
      if (!old) throw notFound('Product')
      // lowering opening stock must not push on-hand below zero
      const delta = input.openingStock - old.openingStock
      if (delta < 0) await assertStockAvailable(tx, new Map([[id, delta]]))
      const [updated] = await tx.update(products).set({ ...input, code: old.code }).where(eq(products.id, id)).returning()
      return updated
    })
    res.json(toProduct(row))
  })

  r.delete('/products/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const [used] = await rows<{ n: number }>(
      db,
      sql`select (select count(*) from sales_lines where product_id = ${id}) + (select count(*) from purchase_lines where product_id = ${id}) + (select count(*) from stock_adjustments where product_id = ${id}) as n`,
    )
    if (Number(used.n) > 0) throw conflict('This item is on invoices or adjustments. Mark it inactive instead of deleting.')
    const del = await db.delete(products).where(eq(products.id, id)).returning({ id: products.id })
    if (!del.length) throw notFound('Product')
    res.json({ ok: true })
  })

  r.post('/products/bulk-price', async (req, res) => {
    const input = parse(bulkPriceSchema, req.body)
    const list = (await db.select().from(products)).filter((p) => input.ids.includes(p.id))
    const round = (v: number) => (input.roundTo > 0 ? Math.round(v / input.roundTo) * input.roundTo : round2(v))
    await db.transaction(async (tx) => {
      for (const p of list) {
        const base = input.mode === 'fromList' ? p.listPrice : p[input.field]
        const field = input.mode === 'fromList' ? 'sellPrice' : input.field
        const value = Math.max(0, round(base * (1 + input.pct / 100)))
        await tx.update(products).set({ [field]: value }).where(eq(products.id, p.id))
      }
    })
    res.json({ updated: list.length })
  })

  // ---------------- customer types (Shop, Medical Center, Pharmacy …)
  r.get('/customer-types', async (_req, res) => {
    const counts = await rows<{ type_id: number; n: number }>(db, sql`select type_id, count(*)::int as n from customers group by type_id`)
    const cmap = new Map(counts.map((c) => [c.type_id, c.n]))
    const types = await db.select().from(customerTypes).orderBy(asc(customerTypes.sort), asc(customerTypes.id))
    res.json(types.map((t) => ({ ...t, customerCount: cmap.get(t.id) ?? 0 })))
  })
  r.post('/customer-types', async (req, res) => {
    const [row] = await db.insert(customerTypes).values(parse(customerTypeSchema, req.body)).returning()
    res.status(201).json(row)
  })
  r.put('/customer-types/:id', async (req, res) => {
    const [row] = await db.update(customerTypes).set(parse(customerTypeSchema, req.body)).where(eq(customerTypes.id, idParam(req.params.id))).returning()
    if (!row) throw notFound('Customer type')
    res.json(row)
  })
  r.delete('/customer-types/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const [used] = await db.select({ id: customers.id }).from(customers).where(eq(customers.typeId, id)).limit(1)
    if (used) throw conflict('Customers use this type. Move them to another type first.')
    await db.delete(customerTypes).where(eq(customerTypes.id, id))
    res.json({ ok: true })
  })

  // ---------------- pricing
  r.get('/pricing/context', async (_req, res) => {
    res.json(await pricingContext(db))
  })

  /** Upsert many rules at once. A rule with neither price nor discount is removed. */
  r.put('/price-rules', async (req, res) => {
    const { rules } = parse(priceRulesBatchSchema, req.body)
    await db.transaction(async (tx) => {
      for (const rule of rules) {
        if (rule.price == null && rule.discPct == null) {
          await tx.delete(priceRules).where(sql`${priceRules.productId} = ${rule.productId} and ${priceRules.customerTypeId} = ${rule.customerTypeId}`)
        } else {
          await tx
            .insert(priceRules)
            .values(rule)
            .onConflictDoUpdate({ target: [priceRules.productId, priceRules.customerTypeId], set: { price: rule.price, discPct: rule.discPct } })
        }
      }
    })
    res.json({ ok: true, count: rules.length })
  })

  /** Full price list for one customer type — used for the price grid and printable price lists. */
  r.get('/price-list', async (req, res) => {
    const { typeId } = z.object({ typeId: z.coerce.number().int() }).parse(req.query)
    const q = listQuerySchema.extend({ pageSize: z.coerce.number().int().min(1).max(500).default(500) }).parse(req.query)
    const ctx = await pricingContext(db)
    const type = ctx.types.find((t) => t.id === typeId)
    if (!type) throw notFound('Customer type')
    const date = todayLK()
    const list = (await productsWithStock(db))
      .filter((p) => p.active)
      .map((p) => {
        const quote = quotePrice({ product: p, customer: { typeId, discPct: null }, ...ctx, qty: 1, date })
        const rule = ctx.rules.find((x) => x.productId === p.id && x.customerTypeId === typeId) ?? null
        return {
          productId: p.id, code: p.code, name: p.name, size: p.size, category: p.category,
          sellPrice: p.sellPrice, avgCost: p.avgCost, onHand: p.onHand, rule, quote,
          margin: quote.netUnitPrice > 0 ? round2(((quote.netUnitPrice - p.avgCost) / quote.netUnitPrice) * 100) : 0,
        }
      })
    const { filtered: _f, ...page } = paginate(list, q, {
      search: (p) => `${p.code} ${p.size} ${p.name} ${p.category}`,
      sorters: { name: (p) => `${p.name} ${String(100000 + sizeRank(p.size)).padStart(8, '0')}`, code: (p) => p.code, net: (p) => p.quote.netUnitPrice, margin: (p) => p.margin },
      defaultSort: { key: 'name', dir: 'asc' },
    })
    res.json({ type, ...page })
  })

  r.get('/promotions', async (_req, res) => {
    const list = await rows(
      db,
      sql`select pr.id, pr.name, pr.product_id as "productId", pr.customer_type_id as "customerTypeId", pr.buy_qty as "buyQty",
                 pr.free_qty as "freeQty", pr.start_date as "startDate", pr.end_date as "endDate", pr.active,
                 p.size || ' ' || p.name as "productLabel", p.code as "productCode", ct.name as "typeName"
          from promotions pr join products p on p.id = pr.product_id left join customer_types ct on ct.id = pr.customer_type_id
          order by p.name, pr.id`,
    )
    res.json(list)
  })
  r.post('/promotions', async (req, res) => {
    const [row] = await db.insert(promotions).values(parse(promotionSchema, req.body)).returning()
    res.status(201).json(row)
  })
  r.put('/promotions/:id', async (req, res) => {
    const [row] = await db.update(promotions).set(parse(promotionSchema, req.body)).where(eq(promotions.id, idParam(req.params.id))).returning()
    if (!row) throw notFound('Promotion')
    res.json(row)
  })
  r.delete('/promotions/:id', async (req, res) => {
    await db.delete(promotions).where(eq(promotions.id, idParam(req.params.id)))
    res.json({ ok: true })
  })

  return r
}
