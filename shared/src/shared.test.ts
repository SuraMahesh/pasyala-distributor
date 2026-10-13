import { describe, expect, it } from 'vitest'
import {
  allocateDues,
  amountInWords,
  freeQtyFor,
  invoiceTotals,
  landedUnitCost,
  lineNet,
  quotePrice,
  salesInvoiceSchema,
  type CustomerType,
  type PriceRule,
  type Promotion,
} from './index'

describe('invoice maths', () => {
  it('line net applies discount and rounds to cents', () => {
    expect(lineNet({ qty: 12, freeQty: 1, unitPrice: 170, discPct: 22 })).toBe(1591.2)
    expect(lineNet({ qty: 24, freeQty: 0, unitPrice: 220, discPct: 22 })).toBe(4118.4)
  })

  it('reproduces printed Pasyale invoice HOSI005942 exactly', () => {
    const L = (qty: number, unitPrice: number) => ({ qty, freeQty: 0, unitPrice, discPct: 22 })
    const t = invoiceTotals([L(1, 16000), L(3, 3100), L(6, 3100), L(1, 5000), L(3, 850)], 8)
    expect(t.subTotal).toBe(40131)
    expect(t.billDiscount).toBe(3210.48)
    expect(t.netTotal).toBe(36920.52)
    expect(t.gross).toBe(51450)
    expect(t.lineDiscount).toBe(11319)
  })

  it('landed cost spreads free units and bill discount', () => {
    // 12 paid + 1 free at 200 less 22% less 8%
    expect(landedUnitCost({ qty: 12, freeQty: 1, unitPrice: 200, discPct: 22 }, 8)).toBeCloseTo((1872 * 0.92) / 13, 6)
    expect(landedUnitCost({ qty: 0, freeQty: 0, unitPrice: 200, discPct: 0 }, 0)).toBe(0)
  })

  it('amount in words matches supplier print', () => {
    expect(amountInWords(78677.66)).toBe('SEVENTY EIGHT THOUSAND SIX HUNDRED SEVENTY SEVEN AND CENTS SIXTY SIX ONLY')
    expect(amountInWords(161460)).toBe('ONE HUNDRED SIXTY ONE THOUSAND FOUR HUNDRED SIXTY ONLY')
    expect(amountInWords(0)).toBe('ZERO ONLY')
  })
})

describe('pricing for shops and medical centers', () => {
  const types: CustomerType[] = [
    { id: 1, code: 'SHOP', name: 'Shop', defaultDiscPct: 15, creditDays: 30, sort: 1 },
    { id: 2, code: 'MEDICAL', name: 'Medical Center', defaultDiscPct: 20, creditDays: 45, sort: 2 },
  ]
  const rules: PriceRule[] = [
    { id: 1, productId: 10, customerTypeId: 2, price: 150, discPct: null },
    { id: 2, productId: 11, customerTypeId: 1, price: null, discPct: 5 },
  ]
  const promos: Promotion[] = [
    { id: 1, name: '12+1', productId: 10, customerTypeId: null, buyQty: 12, freeQty: 1, startDate: null, endDate: null, active: true },
    { id: 2, name: 'MC 10+2', productId: 10, customerTypeId: 2, buyQty: 10, freeQty: 2, startDate: '2026-01-01', endDate: '2026-12-31', active: true },
    { id: 3, name: 'old', productId: 11, customerTypeId: null, buyQty: 6, freeQty: 1, startDate: null, endDate: '2025-01-01', active: true },
  ]
  const base = { types, rules, promotions: promos, date: '2026-10-12' }

  it('uses customer type default discount', () => {
    const q = quotePrice({ ...base, product: { id: 12, sellPrice: 200 }, customer: { typeId: 1, discPct: null }, qty: 1 })
    expect(q).toMatchObject({ unitPrice: 200, discPct: 15, netUnitPrice: 170, source: 'customer-type' })
  })
  it('customer discount overrides type default', () => {
    const q = quotePrice({ ...base, product: { id: 12, sellPrice: 200 }, customer: { typeId: 1, discPct: 10 }, qty: 1 })
    expect(q).toMatchObject({ discPct: 10, source: 'customer' })
  })
  it('product rule (fixed price) beats everything for that type', () => {
    const q = quotePrice({ ...base, product: { id: 10, sellPrice: 200 }, customer: { typeId: 2, discPct: 30 }, qty: 24 })
    expect(q).toMatchObject({ unitPrice: 150, discPct: 0, source: 'product-rule-price' })
    // medical-center-only promo (10+2) wins over general 12+1
    expect(q.promotion?.id).toBe(2)
    expect(q.freeQty).toBe(4)
  })
  it('product rule discount for shops', () => {
    const q = quotePrice({ ...base, product: { id: 11, sellPrice: 300 }, customer: { typeId: 1, discPct: null }, qty: 12 })
    expect(q).toMatchObject({ unitPrice: 300, discPct: 5, source: 'product-rule-disc', freeQty: 0 }) // promo 3 expired
  })
  it('shop gets the general promotion', () => {
    const q = quotePrice({ ...base, product: { id: 10, sellPrice: 200 }, customer: { typeId: 1, discPct: null }, qty: 25 })
    expect(q.promotion?.id).toBe(1)
    expect(q.freeQty).toBe(2)
  })
  it('free qty helper', () => {
    expect(freeQtyFor({ buyQty: 12, freeQty: 1 }, 11)).toBe(0)
    expect(freeQtyFor({ buyQty: 12, freeQty: 1 }, 36)).toBe(3)
  })
})

describe('FIFO dues', () => {
  const inv = (id: number, date: string, net: number, paid = 0, creditDays = 30) => ({ id, date, netTotal: net, paidOnInvoice: paid, creditDays })

  it('applies payments to oldest invoice first', () => {
    const { byInvoice, summary } = allocateDues([inv(2, '2026-10-05', 500), inv(1, '2026-10-01', 1000, 200)], 900, '2026-10-12')
    expect(byInvoice.get(1)).toMatchObject({ paid: 1000, due: 0, status: 'paid' })
    expect(byInvoice.get(2)).toMatchObject({ paid: 100, due: 400, status: 'partial', overdue: false })
    expect(summary).toMatchObject({ billed: 1500, paid: 1100, balance: 400 })
  })

  it('flags overdue after credit days', () => {
    const { byInvoice, summary } = allocateDues([inv(1, '2026-09-01', 1000, 0, 30)], 0, '2026-10-12')
    expect(byInvoice.get(1)).toMatchObject({ dueDate: '2026-10-01', overdue: true })
    expect(summary.overdue).toBe(1000)
    expect(summary.oldestDueDate).toBe('2026-10-01')
  })

  it('over-payment becomes credit (negative balance)', () => {
    const { byInvoice, summary } = allocateDues([inv(1, '2026-10-01', 1000, 1200)], 0, '2026-10-12')
    expect(byInvoice.get(1)?.status).toBe('paid')
    expect(summary.balance).toBe(-200)
  })
})

describe('validation', () => {
  it('rejects empty invoices and zero-qty lines', () => {
    const base = { date: '2026-10-12', customerId: 1, payMethod: 'Cash', billDiscPct: 0, paidOnInvoice: 0, notes: '' }
    expect(salesInvoiceSchema.safeParse({ ...base, lines: [] }).success).toBe(false)
    expect(salesInvoiceSchema.safeParse({ ...base, lines: [{ productId: 1, qty: 0, freeQty: 0, unitPrice: 10, discPct: 0 }] }).success).toBe(false)
    expect(salesInvoiceSchema.safeParse({ ...base, lines: [{ productId: 1, qty: 1, freeQty: 0, unitPrice: 10, discPct: 120 }] }).success).toBe(false)
    expect(salesInvoiceSchema.safeParse({ ...base, lines: [{ productId: 1, qty: 1, freeQty: 0, unitPrice: 10, discPct: 10 }] }).success).toBe(true)
  })
})

import { suggestProductCode, sizeDigits } from './index'
describe('automatic item codes', () => {
  it('follows the supplier code style', () => {
    expect(suggestProductCode('Maha Narayana', '30ML', 'Thailaya (Oil)')).toBe('THMN0030')
    expect(suggestProductCode('kedumbindum', '4.5L', 'Thailaya (Oil)')).toBe('THKD4500')
    expect(suggestProductCode('Ashwaganda Choorna', '50g', 'Choorna / Powder')).toBe('CHAC0050')
    expect(suggestProductCode('Dhathri Rasayana', '1kg', 'Rasayana')).toBe('RSDR1000')
  })
  it('handles odd sizes', () => {
    expect(sizeDigits('750 ml')).toBe('0750')
    expect(sizeDigits('box')).toBe('0000')
  })
})
