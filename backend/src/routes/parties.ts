import { Router } from 'express'
import { asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  customerSchema,
  listQuerySchema,
  round2,
  supplierSchema,
  type CustomerWithBalance,
  type StatementRow,
  type SupplierWithBalance,
} from '@pjd/shared'
import type { DB, Executor } from '../db/client'
import { customers, customerTypes, suppliers } from '../db/schema'
import { conflict, idParam, notFound, parse } from '../errors'
import { paginate } from '../lib/list'
import { customerDues, supplierDues } from '../services/dues'
import { rows } from '../services/stock'

export async function customersWithBalance(ex: Executor): Promise<CustomerWithBalance[]> {
  const list = await ex
    .select({ c: customers, typeName: customerTypes.name })
    .from(customers)
    .innerJoin(customerTypes, eq(customerTypes.id, customers.typeId))
    .orderBy(asc(customers.name))
  const dues = await customerDues(ex)
  return list.map(({ c, typeName }) => {
    const { createdAt: _c, ...rest } = c
    const b = dues.get(c.id)
    return { ...rest, ...b, typeName, overLimit: c.creditLimit > 0 && b.balance > c.creditLimit }
  })
}

export async function suppliersWithBalance(ex: Executor): Promise<SupplierWithBalance[]> {
  const list = await ex.select().from(suppliers).orderBy(asc(suppliers.name))
  const dues = await supplierDues(ex)
  const last = await rows<{ supplier_id: number; bill_disc_pct: number }>(
    ex,
    sql`select distinct on (supplier_id) supplier_id, bill_disc_pct from purchase_invoices order by supplier_id, date desc, created_at desc, id desc`,
  )
  const lastBill = new Map(last.map((r) => [r.supplier_id, Number(r.bill_disc_pct)]))
  return list.map((s) => {
    const { createdAt: _c, ...rest } = s
    return { ...rest, ...dues.get(s.id), lastBillDiscPct: lastBill.get(s.id) ?? null }
  })
}

async function statement(ex: Executor, kind: 'customer' | 'supplier', id: number): Promise<StatementRow[]> {
  const inv = kind === 'customer'
    ? sql`select date::text, invoice_no as ref, id as "refId", net_total, paid_on_invoice, pay_method, created_at from sales_invoices where customer_id = ${id}`
    : sql`select date::text, invoice_no as ref, id as "refId", net_total, paid_on_invoice, pay_method, created_at from purchase_invoices where supplier_id = ${id}`
  const pay = kind === 'customer'
    ? sql`select date::text, reference, id, amount, method, notes, created_at from payments where customer_id = ${id}`
    : sql`select date::text, reference, id, amount, method, notes, created_at from payments where supplier_id = ${id}`
  const invoices = await rows<{ date: string; ref: string; refId: number; net_total: number; paid_on_invoice: number; pay_method: string; created_at: string }>(ex, inv)
  const pays = await rows<{ date: string; reference: string; id: number; amount: number; method: string; notes: string; created_at: string }>(ex, pay)
  const list: (Omit<StatementRow, 'balance'> & { order: string })[] = []
  for (const i of invoices) {
    list.push({ date: i.date, type: 'Invoice', ref: i.ref, refId: i.refId, debit: i.net_total, credit: 0, note: i.pay_method, order: `${i.created_at}-0` })
    if (i.paid_on_invoice > 0) list.push({ date: i.date, type: 'Paid on invoice', ref: i.ref, refId: i.refId, debit: 0, credit: i.paid_on_invoice, note: i.pay_method, order: `${i.created_at}-1` })
  }
  for (const p of pays) list.push({ date: p.date, type: 'Payment', ref: p.reference || `PAY-${p.id}`, refId: null, debit: 0, credit: p.amount, note: [p.method, p.notes].filter(Boolean).join(' · '), order: `${p.created_at}-2` })
  list.sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order))
  let bal = 0
  return list.map(({ order: _o, ...r }) => ({ ...r, balance: (bal = round2(bal + r.debit - r.credit)) }))
}

const customerFilters = listQuerySchema.extend({
  typeId: z.coerce.number().int().optional(),
  area: z.string().default(''),
  status: z.enum(['', 'owing', 'overdue', 'overLimit', 'credit']).default(''),
  active: z.enum(['', 'active', 'inactive']).default(''),
})

const partySorters = {
  code: (c: { code: string }) => c.code,
  name: (c: { name: string }) => c.name,
  billed: (c: { billed: number }) => c.billed,
  balance: (c: { balance: number }) => c.balance,
  overdue: (c: { overdue: number }) => c.overdue,
  invoices: (c: { invoices: number }) => c.invoices,
}

export function partyRoutes(db: DB) {
  const r = Router()

  // ---------------- customers (shops, medical centers, pharmacies …)
  r.get('/customers', async (req, res) => {
    const q = customerFilters.parse(req.query)
    let list = await customersWithBalance(db)
    if (q.typeId) list = list.filter((c) => c.typeId === q.typeId)
    if (q.area) list = list.filter((c) => c.area.toLowerCase() === q.area.toLowerCase())
    if (q.active) list = list.filter((c) => c.active === (q.active === 'active'))
    if (q.status === 'owing') list = list.filter((c) => c.balance > 0.004)
    if (q.status === 'overdue') list = list.filter((c) => c.overdue > 0.004)
    if (q.status === 'overLimit') list = list.filter((c) => c.overLimit)
    if (q.status === 'credit') list = list.filter((c) => c.balance < -0.004)
    const { filtered, ...page } = paginate(list, q, {
      search: (c) => `${c.code} ${c.name} ${c.area} ${c.phone} ${c.typeName}`,
      sorters: { ...partySorters, type: (c) => c.typeName, area: (c) => c.area },
      defaultSort: { key: 'name', dir: 'asc' },
    })
    const summary = {
      receivable: round2(filtered.reduce((s, c) => s + Math.max(c.balance, 0), 0)),
      overdue: round2(filtered.reduce((s, c) => s + c.overdue, 0)),
      overLimit: filtered.filter((c) => c.overLimit).length,
    }
    res.json({ ...page, summary })
  })

  r.get('/customers/options', async (_req, res) => {
    const list = await customersWithBalance(db)
    res.json(list.map((c) => ({ id: c.id, code: c.code, name: c.name, typeId: c.typeId, typeName: c.typeName, area: c.area, discPct: c.discPct, creditLimit: c.creditLimit, balance: c.balance, overdue: c.overdue, active: c.active })))
  })

  r.get('/customers/areas', async (_req, res) => {
    const list = await rows<{ area: string }>(db, sql`select distinct area from customers where area <> '' order by area`)
    res.json(list.map((a) => a.area))
  })

  r.get('/customers/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const c = (await customersWithBalance(db)).find((x) => x.id === id)
    if (!c) throw notFound('Customer')
    res.json({ customer: c, statement: await statement(db, 'customer', id) })
  })

  r.post('/customers', async (req, res) => {
    const [row] = await db.insert(customers).values(parse(customerSchema, req.body)).returning()
    res.status(201).json(row)
  })
  r.put('/customers/:id', async (req, res) => {
    const [row] = await db.update(customers).set(parse(customerSchema, req.body)).where(eq(customers.id, idParam(req.params.id))).returning()
    if (!row) throw notFound('Customer')
    res.json(row)
  })
  r.delete('/customers/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const [used] = await rows<{ n: number }>(db, sql`select (select count(*) from sales_invoices where customer_id = ${id}) + (select count(*) from payments where customer_id = ${id}) as n`)
    if (Number(used.n) > 0) throw conflict('This customer has invoices or payments. Mark them inactive instead.')
    const del = await db.delete(customers).where(eq(customers.id, id)).returning({ id: customers.id })
    if (!del.length) throw notFound('Customer')
    res.json({ ok: true })
  })

  // ---------------- suppliers
  r.get('/suppliers', async (req, res) => {
    const q = listQuerySchema.parse(req.query)
    const { filtered, ...page } = paginate(await suppliersWithBalance(db), q, {
      search: (s) => `${s.code} ${s.name} ${s.phone} ${s.address}`,
      sorters: partySorters,
      defaultSort: { key: 'name', dir: 'asc' },
    })
    res.json({ ...page, summary: { payable: round2(filtered.reduce((s, c) => s + Math.max(c.balance, 0), 0)) } })
  })
  r.get('/suppliers/options', async (_req, res) => {
    const list = await suppliersWithBalance(db)
    res.json(list.map((s) => ({ id: s.id, code: s.code, name: s.name, balance: s.balance, active: s.active, lastBillDiscPct: s.lastBillDiscPct })))
  })
  r.get('/suppliers/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const s = (await suppliersWithBalance(db)).find((x) => x.id === id)
    if (!s) throw notFound('Supplier')
    res.json({ supplier: s, statement: await statement(db, 'supplier', id) })
  })
  r.post('/suppliers', async (req, res) => {
    const [row] = await db.insert(suppliers).values(parse(supplierSchema, req.body)).returning()
    res.status(201).json(row)
  })
  r.put('/suppliers/:id', async (req, res) => {
    const [row] = await db.update(suppliers).set(parse(supplierSchema, req.body)).where(eq(suppliers.id, idParam(req.params.id))).returning()
    if (!row) throw notFound('Supplier')
    res.json(row)
  })
  r.delete('/suppliers/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const [used] = await rows<{ n: number }>(db, sql`select (select count(*) from purchase_invoices where supplier_id = ${id}) + (select count(*) from payments where supplier_id = ${id}) as n`)
    if (Number(used.n) > 0) throw conflict('This supplier has invoices or payments. Mark them inactive instead.')
    const del = await db.delete(suppliers).where(eq(suppliers.id, id)).returning({ id: suppliers.id })
    if (!del.length) throw notFound('Supplier')
    res.json({ ok: true })
  })

  return r
}
