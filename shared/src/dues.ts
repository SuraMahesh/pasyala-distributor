import { addDays, round2 } from './calc'
import type { InvoiceStatus, PartyBalance } from './types'

export interface DueInvoice {
  id: number
  date: string
  netTotal: number
  paidOnInvoice: number
  creditDays: number
  /** sales returns credited against this invoice (net of cash refunds) */
  credited?: number
  /** when set (a cheque that is not paid yet), the invoice falls due on this date instead of date + credit days */
  dueDate?: string
}

export interface DueResult {
  /** everything applied to the invoice: cash paid on it, returns credited against it and FIFO allocations */
  paid: number
  /** the part of `paid` that came from returns recorded against this invoice */
  credited: number
  due: number
  status: InvoiceStatus
  dueDate: string
  overdue: boolean
}

/**
 * Works out how much of each invoice is still unpaid for ONE customer or supplier.
 * Money paid on the invoice itself (and a return recorded against it) is applied to that invoice; separate payments,
 * returns not tied to an invoice and any over-payment are applied to the oldest open invoices first (FIFO).
 * `creditsTotal` = returns credited to the party without an invoice (net of refunds).
 */
export function allocateDues(invoices: DueInvoice[], paymentsTotal: number, today: string, creditsTotal = 0) {
  const sorted = [...invoices].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const result = new Map<number, DueResult>()
  let pool = round2(paymentsTotal + creditsTotal)
  const open: { inv: DueInvoice; paid: number; credited: number }[] = []

  for (const inv of sorted) {
    const credited = Math.min(inv.credited ?? 0, inv.netTotal)
    const direct = Math.min(inv.paidOnInvoice, inv.netTotal - credited)
    pool = round2(pool + inv.paidOnInvoice - direct + (inv.credited ?? 0) - credited) // over-payment / over-credit becomes general credit
    open.push({ inv, paid: round2(direct + credited), credited })
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
  for (const { inv, paid, credited } of open) {
    const due = round2(inv.netTotal - paid)
    const dueDate = inv.dueDate ?? addDays(inv.date, inv.creditDays)
    const isOverdue = due > 0.004 && dueDate < today
    billed += inv.netTotal
    if (isOverdue) overdue += due
    if (due > 0.004 && (!oldestDueDate || dueDate < oldestDueDate)) oldestDueDate = dueDate
    result.set(inv.id, {
      paid,
      credited,
      due: Math.max(due, 0),
      status: due <= 0.004 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
      dueDate,
      overdue: isOverdue,
    })
  }
  const paidTotal = round2(invoices.reduce((s, i) => s + i.paidOnInvoice, 0) + paymentsTotal)
  const returned = round2(invoices.reduce((s, i) => s + (i.credited ?? 0), 0) + creditsTotal)
  const summary: PartyBalance = {
    billed: round2(billed),
    paid: paidTotal,
    returned,
    balance: round2(billed - returned - paidTotal), // negative = customer has credit with us
    invoices: invoices.length,
    overdue: round2(overdue),
    oldestDueDate,
  }
  return { byInvoice: result, summary }
}
