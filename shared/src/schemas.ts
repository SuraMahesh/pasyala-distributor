import { z } from 'zod'
import { ADJ_REASONS, CATEGORIES, PAY_METHODS } from './types'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be yyyy-mm-dd')
const money = z.number().finite().min(0, 'Must be 0 or more').max(1e10)
const pct = z.number().finite().min(0, 'Must be 0–100').max(100, 'Must be 0–100')
const qty = z.number().int('Whole numbers only').min(0, 'Must be 0 or more').max(1e7)
const text = (max = 200) => z.string().trim().max(max).default('')
const reqText = (label: string, max = 200) => z.string().trim().min(1, `${label} is required`).max(max)

export const settingsSchema = z.object({
  name: reqText('Business name'),
  address: text(),
  phone: text(50),
  email: text(100),
  invoicePrefix: text(10),
  nextInvoiceNo: z.number().int().min(1),
  footerNote: text(300),
  supplierCustomerCode: text(30),
  allowNegativeStock: z.boolean(),
})

export const customerTypeSchema = z.object({
  code: reqText('Code', 20).transform((s) => s.toUpperCase()),
  name: reqText('Name', 60),
  defaultDiscPct: pct,
  creditDays: z.number().int().min(0).max(365),
  sort: z.number().int().default(0),
})

export const productSchema = z.object({
  code: z.string().trim().max(30).default('').transform((s) => s.toUpperCase()), // empty = auto from name + size
  name: reqText('Name', 120).transform((s) => s.toUpperCase()),
  size: reqText('Size', 20),
  category: z.enum(CATEGORIES),
  listPrice: money,
  supplierDiscPct: pct,
  sellPrice: money,
  reorderLevel: qty,
  openingStock: qty,
  active: z.boolean().default(true),
})

export const bulkPriceSchema = z.object({
  ids: z.array(z.number().int()).min(1, 'No products selected'),
  field: z.enum(['sellPrice', 'listPrice']),
  mode: z.enum(['percent', 'fromList']), // fromList: sellPrice = listPrice × (1 + pct)
  pct: z.number().min(-90).max(500),
  roundTo: z.number().min(0).max(1000),
})

export const priceRuleSchema = z
  .object({
    productId: z.number().int(),
    customerTypeId: z.number().int(),
    price: money.nullable(),
    discPct: pct.nullable(),
  })
  .refine((r) => r.price == null || r.discPct == null, 'Use either a fixed price or a discount %, not both')

export const priceRulesBatchSchema = z.object({ rules: z.array(priceRuleSchema).max(5000) })

export const promotionSchema = z
  .object({
    name: text(80),
    productId: z.number().int(),
    customerTypeId: z.number().int().nullable(),
    buyQty: z.number().int().min(1, 'Buy qty must be at least 1'),
    freeQty: z.number().int().min(1, 'Free qty must be at least 1'),
    startDate: date.nullable(),
    endDate: date.nullable(),
    active: z.boolean().default(true),
  })
  .refine((p) => !p.startDate || !p.endDate || p.startDate <= p.endDate, 'End date is before start date')

export const customerSchema = z.object({
  code: reqText('Code', 20),
  name: reqText('Name', 120),
  typeId: z.number().int({ message: 'Choose a customer type' }),
  phone: text(50),
  address: text(),
  area: text(60),
  discPct: pct.nullable(),
  creditLimit: money,
  creditDays: z.number().int().min(0).max(365).nullable(),
  notes: text(300),
  active: z.boolean().default(true),
})

export const supplierSchema = z.object({
  code: reqText('Code', 20),
  name: reqText('Name', 120),
  phone: text(50),
  address: text(),
  creditDays: z.number().int().min(0).max(365).default(0),
  notes: text(300),
  active: z.boolean().default(true),
})

export const lineSchema = z
  .object({
    productId: z.number().int({ message: 'Choose an item' }),
    qty,
    freeQty: qty,
    unitPrice: money,
    discPct: pct,
  })
  .refine((l) => l.qty + l.freeQty > 0, 'Qty or free qty must be more than 0')

const invoiceBase = {
  date,
  payMethod: z.enum(PAY_METHODS),
  billDiscPct: pct,
  paidOnInvoice: money,
  notes: text(300),
  lines: z.array(lineSchema).min(1, 'Add at least one item').max(500),
}

export const salesInvoiceSchema = z.object({ ...invoiceBase, customerId: z.number().int({ message: 'Choose a customer' }) })

export const purchaseInvoiceSchema = z.object({
  ...invoiceBase,
  supplierId: z.number().int({ message: 'Choose a supplier' }),
  invoiceNo: reqText('Supplier invoice no', 40).transform((s) => s.toUpperCase()),
  orderNo: text(40),
  salesPerson: text(60),
})

export const paymentSchema = z.object({
  date,
  partyType: z.enum(['customer', 'supplier']),
  partyId: z.number().int({ message: 'Choose who paid' }),
  amount: money.refine((n) => n > 0, 'Amount must be more than 0'),
  method: z.enum(PAY_METHODS).refine((m) => m !== 'Credit', 'Choose how it was paid'),
  reference: text(60),
  notes: text(300),
})

export const adjustmentSchema = z.object({
  date,
  productId: z.number().int({ message: 'Choose an item' }),
  qty: z.number().int().refine((n) => n !== 0, 'Qty cannot be 0'),
  reason: z.enum(ADJ_REASONS),
  notes: text(300),
})

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().default(''),
  sort: z.string().default(''),
  dir: z.enum(['asc', 'desc']).default('asc'),
})

export type SettingsInput = z.infer<typeof settingsSchema>
export type CustomerTypeInput = z.infer<typeof customerTypeSchema>
export type ProductInput = z.infer<typeof productSchema>
export type BulkPriceInput = z.infer<typeof bulkPriceSchema>
export type PriceRuleInput = z.infer<typeof priceRuleSchema>
export type PromotionInput = z.infer<typeof promotionSchema>
export type CustomerInput = z.infer<typeof customerSchema>
export type SupplierInput = z.infer<typeof supplierSchema>
export type LineInput = z.infer<typeof lineSchema>
export type SalesInvoiceInput = z.infer<typeof salesInvoiceSchema>
export type PurchaseInvoiceInput = z.infer<typeof purchaseInvoiceSchema>
export type PaymentInput = z.infer<typeof paymentSchema>
export type AdjustmentInput = z.infer<typeof adjustmentSchema>
export type ListQuery = z.infer<typeof listQuerySchema>
