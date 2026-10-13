import { addDays, round2 } from './calc'
import type { InvoiceStatus, PartyBalance } from './types'

export interface DueInvoice {
  id: number
  date: string
  netTotal: number
  paidOnInvoice: number
  creditDays: number
}

export interface DueResult {
  paid: number
  due: number
  status: InvoiceStatus
  dueDate: string
  overdue: boolean
}

/**
 * Works out how much of each invoice is still unpaid for ONE customer or supplier.
 * Money paid on the invoice itself is applied to that invoice; separate payments
 * (and any over-payment on an invoice) are applied to the oldest open invoices first (FIFO).
 */
export function allocateDues(invoices: DueInvoice[], paymentsTotal: number, today: string) {
  const sorted = [...invoices].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const result = new Map<number, DueResult>()
  let pool = paymentsTotal
  const open: { inv: DueInvoice; paid: number }[] = []

  for (const inv of sorted) {
    const direct = Math.min(inv.paidOnInvoice, inv.netTotal)
    pool += inv.paidOnInvoice - direct // over-payment becomes general credit
    open.push({ inv, paid: direct })
  }
  for (const o of open) {
    const need = round2(o.inv.netTotal - o.paid)
    if (need > 0 && pool > 0) {
      const take = Math.min(need, pool)
      o.paid = round2(o.paid + take)
      pool = round2(pool - take)
    }
  }
  let billed = 0
  let overdue = 0
  let oldestDueDate: string | null = null
  for (const { inv, paid } of open) {
    const due = round2(inv.netTotal - paid)
    const dueDate = addDays(inv.date, inv.creditDays)
    const isOverdue = due > 0.004 && dueDate < today
    billed += inv.netTotal
    if (isOverdue) overdue += due
    if (due > 0.004 && (!oldestDueDate || dueDate < oldestDueDate)) oldestDueDate = dueDate
    result.set(inv.id, {
      paid,
      due: Math.max(due, 0),
      status: due <= 0.004 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
      dueDate,
      overdue: isOverdue,
    })
  }
  const paidTotal = round2(invoices.reduce((s, i) => s + i.paidOnInvoice, 0) + paymentsTotal)
  const summary: PartyBalance = {
    billed: round2(billed),
    paid: paidTotal,
    balance: round2(billed - paidTotal), // negative = customer has credit with us
    invoices: invoices.length,
    overdue: round2(overdue),
    oldestDueDate,
  }
  return { byInvoice: result, summary }
}
