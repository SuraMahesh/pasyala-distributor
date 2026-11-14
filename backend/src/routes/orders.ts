import { Router } from 'express'
import { and, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { listQuerySchema, ORDER_REQUEST_STATUSES, orderRequestSchema, round2 } from '@pjd/shared'
import type { DB } from '../db/client'
import { orderRequests, suppliers } from '../db/schema'
import { idParam, parse } from '../errors'
import { paginate } from '../lib/list'
import { deleteOrderRequest, getOrderRequest, saveOrderRequest, setOrderRequestFlags } from '../services/orders'
import { productsWithStock } from './catalog'

const dateQ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined))

/** Order requests (purchase orders) to the supplier */
export function orderRoutes(db: DB) {
  const r = Router()

  r.get('/order-requests', async (req, res) => {
    const q = listQuerySchema
      .extend({ from: dateQ, to: dateQ, supplierId: z.coerce.number().int().optional(), status: z.enum(['', 'open', ...ORDER_REQUEST_STATUSES]).default('') })
      .parse(req.query)
    const where: SQL[] = []
    if (q.from) where.push(gte(orderRequests.date, q.from))
    if (q.to) where.push(lte(orderRequests.date, q.to))
    if (q.supplierId) where.push(eq(orderRequests.supplierId, q.supplierId))
    if (q.status === 'open') where.push(sql`${orderRequests.status} in ('draft', 'sent')`)
    else if (q.status) where.push(eq(orderRequests.status, q.status))
    const list = await db
      .select({
        id: orderRequests.id, requestNo: orderRequests.requestNo, date: orderRequests.date, status: orderRequests.status, showPrices: orderRequests.showPrices,
        notes: orderRequests.notes, supplierId: orderRequests.supplierId, supplierName: suppliers.name,
        lineCount: sql<number>`(select count(*)::int from order_request_lines l where l.request_id = ${orderRequests.id})`,
        units: sql<number>`(select coalesce(sum(l.qty), 0)::int from order_request_lines l where l.request_id = ${orderRequests.id})`,
        total: sql<number | null>`(select round(sum(l.qty * l.unit_price), 2)::float8 from order_request_lines l where l.request_id = ${orderRequests.id} and l.unit_price is not null)`,
        unpriced: sql<number>`(select count(*)::int from order_request_lines l where l.request_id = ${orderRequests.id} and l.unit_price is null)`,
      })
      .from(orderRequests)
      .innerJoin(suppliers, eq(suppliers.id, orderRequests.supplierId))
      .where(where.length ? and(...where) : undefined)
    const { filtered, ...page } = paginate(list, q, {
      search: (i) => `${i.requestNo} ${i.supplierName} ${i.notes} ${i.status}`,
      sorters: {
        requestNo: (i) => i.requestNo,
        date: (i) => `${i.date}-${String(i.id).padStart(9, '0')}`,
        supplier: (i) => i.supplierName,
        status: (i) => i.status,
        units: (i) => i.units,
        total: (i) => i.total ?? -1,
      },
      defaultSort: { key: 'date', dir: 'desc' },
    })
    res.json({
      ...page,
      summary: {
        count: filtered.length,
        open: filtered.filter((i) => i.status === 'draft' || i.status === 'sent').length,
        units: filtered.reduce((s, i) => s + i.units, 0),
        total: round2(filtered.reduce((s, i) => s + (i.total ?? 0), 0)),
      },
    })
  })

  // items at or below their reorder level, with a quantity that brings them to twice the level (at least 1)
  r.get('/order-requests/suggestions', async (_req, res) => {
    const low = (await productsWithStock(db)).filter((p) => p.active && p.onHand <= p.reorderLevel)
    res.json(
      low
        .sort((a, b) => a.onHand - b.onHand || a.name.localeCompare(b.name))
        .map((p) => ({ productId: p.id, code: p.code, name: p.name, size: p.size, onHand: p.onHand, reorderLevel: p.reorderLevel, qty: Math.max(1, p.reorderLevel * 2 - p.onHand), unitPrice: p.listPrice > 0 ? p.listPrice : null })),
    )
  })

  r.get('/order-requests/:id', async (req, res) => res.json(await getOrderRequest(db, idParam(req.params.id))))
  r.post('/order-requests', async (req, res) => res.status(201).json(await saveOrderRequest(db, parse(orderRequestSchema, req.body))))
  r.put('/order-requests/:id', async (req, res) => res.json(await saveOrderRequest(db, parse(orderRequestSchema, req.body), idParam(req.params.id))))
  r.put('/order-requests/:id/flags', async (req, res) => {
    const flags = parse(z.object({ status: z.enum(ORDER_REQUEST_STATUSES).optional(), showPrices: z.boolean().optional() }), req.body)
    res.json(await setOrderRequestFlags(db, idParam(req.params.id), flags))
  })
  r.delete('/order-requests/:id', async (req, res) => {
    await deleteOrderRequest(db, idParam(req.params.id))
    res.json({ ok: true })
  })

  return r
}
