import { sql } from 'drizzle-orm'
import { allocateDues, todayLK, type DueResult, type PartyBalance } from '@pjd/shared'
import type { Executor } from '../db/client'
import { rows } from './stock'

interface InvRow {
  id: number
  party_id: number
  date: string
  net_total: number
  paid_on_invoice: number
  credit_days: number
}

const EMPTY: PartyBalance = { billed: 0, paid: 0, balance: 0, invoices: 0, overdue: 0, oldestDueDate: null }

function compute(invoices: InvRow[], payments: { party_id: number; total: number }[], partyIds: number[], today: string) {
  const byParty = new Map<number, InvRow[]>()
  for (const id of partyIds) byParty.set(id, [])
  for (const inv of invoices) {
    if (!byParty.has(inv.party_id)) byParty.set(inv.party_id, [])
    byParty.get(inv.party_id)!.push(inv)
  }
  const payMap = new Map(payments.map((p) => [p.party_id, Number(p.total)]))
  const byInvoice = new Map<number, DueResult>()
  const summary = new Map<number, PartyBalance>()
  for (const [partyId, list] of byParty) {
    const r = allocateDues(
      list.map((i) => ({ id: i.id, date: i.date, netTotal: Number(i.net_total), paidOnInvoice: Number(i.paid_on_invoice), creditDays: i.credit_days })),
      payMap.get(partyId) ?? 0,
      today,
    )
    r.byInvoice.forEach((v, k) => byInvoice.set(k, v))
    summary.set(partyId, r.summary)
  }
  return {
    byInvoice,
    summary,
    get: (partyId: number) => summary.get(partyId) ?? EMPTY,
  }
}

/** Unpaid amounts for every sales invoice + balance for every customer (FIFO allocation). */
export async function customerDues(ex: Executor, today = todayLK()) {
  const invoices = await rows<InvRow>(
      ex,
      sql`select si.id, si.customer_id as party_id, si.date, si.net_total, si.paid_on_invoice,
                 coalesce(c.credit_days, ct.credit_days, 0) as credit_days
          from sales_invoices si join customers c on c.id = si.customer_id join customer_types ct on ct.id = c.type_id`,
  )
  const payments = await rows<{ party_id: number; total: number }>(
    ex,
    sql`select customer_id as party_id, sum(amount) as total from payments where party_type = 'customer' group by customer_id`,
  )
  const parties = await rows<{ id: number }>(ex, sql`select id from customers`)
  return compute(invoices, payments, parties.map((p) => p.id), today)
}

/** Unpaid amounts for every purchase invoice + balance owed to every supplier. */
export async function supplierDues(ex: Executor, today = todayLK()) {
  const invoices = await rows<InvRow>(
      ex,
      sql`select pi.id, pi.supplier_id as party_id, pi.date, pi.net_total, pi.paid_on_invoice, s.credit_days
          from purchase_invoices pi join suppliers s on s.id = pi.supplier_id`,
  )
  const payments = await rows<{ party_id: number; total: number }>(
    ex,
    sql`select supplier_id as party_id, sum(amount) as total from payments where party_type = 'supplier' group by supplier_id`,
  )
  const parties = await rows<{ id: number }>(ex, sql`select id from suppliers`)
  return compute(invoices, payments, parties.map((p) => p.id), today)
}
