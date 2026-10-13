import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' })
const pct = (name: string) => numeric(name, { precision: 5, scale: 2, mode: 'number' })
const cost = (name: string) => numeric(name, { precision: 14, scale: 4, mode: 'number' })
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const settings = pgTable('settings', {
  id: integer('id').primaryKey().default(1),
  name: text('name').notNull(),
  address: text('address').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  invoicePrefix: text('invoice_prefix').notNull().default('PJD-'),
  nextInvoiceNo: integer('next_invoice_no').notNull().default(1),
  footerNote: text('footer_note').notNull().default(''),
  supplierCustomerCode: text('supplier_customer_code').notNull().default(''),
  allowNegativeStock: boolean('allow_negative_stock').notNull().default(false),
})

export const customerTypes = pgTable('customer_types', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  defaultDiscPct: pct('default_disc_pct').notNull().default(0),
  creditDays: integer('credit_days').notNull().default(0),
  sort: integer('sort').notNull().default(0),
})

export const products = pgTable(
  'products',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    size: text('size').notNull(),
    category: text('category').notNull(),
    listPrice: money('list_price').notNull().default(0),
    supplierDiscPct: pct('supplier_disc_pct').notNull().default(0),
    sellPrice: money('sell_price').notNull().default(0),
    reorderLevel: integer('reorder_level').notNull().default(0),
    openingStock: integer('opening_stock').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: created(),
  },
  (t) => [check('products_prices_ck', sql`${t.listPrice} >= 0 and ${t.sellPrice} >= 0`)],
)

export const priceRules = pgTable(
  'price_rules',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    customerTypeId: integer('customer_type_id').notNull().references(() => customerTypes.id, { onDelete: 'cascade' }),
    price: money('price'),
    discPct: pct('disc_pct'),
  },
  (t) => [uniqueIndex('price_rules_product_type_uq').on(t.productId, t.customerTypeId)],
)

export const promotions = pgTable('promotions', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().default(''),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  customerTypeId: integer('customer_type_id').references(() => customerTypes.id, { onDelete: 'cascade' }),
  buyQty: integer('buy_qty').notNull(),
  freeQty: integer('free_qty').notNull(),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
  active: boolean('active').notNull().default(true),
})

export const customers = pgTable(
  'customers',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    typeId: integer('type_id').notNull().references(() => customerTypes.id, { onDelete: 'restrict' }),
    phone: text('phone').notNull().default(''),
    address: text('address').notNull().default(''),
    area: text('area').notNull().default(''),
    discPct: pct('disc_pct'),
    creditLimit: money('credit_limit').notNull().default(0),
    creditDays: integer('credit_days'),
    notes: text('notes').notNull().default(''),
    active: boolean('active').notNull().default(true),
    createdAt: created(),
  },
  (t) => [index('customers_type_idx').on(t.typeId)],
)

export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  creditDays: integer('credit_days').notNull().default(0),
  notes: text('notes').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: created(),
})

const invoiceMoney = () => ({
  payMethod: text('pay_method').notNull(),
  billDiscPct: pct('bill_disc_pct').notNull().default(0),
  paidOnInvoice: money('paid_on_invoice').notNull().default(0),
  gross: money('gross').notNull(),
  lineDiscount: money('line_discount').notNull(),
  subTotal: money('sub_total').notNull(),
  billDiscount: money('bill_discount').notNull(),
  netTotal: money('net_total').notNull(),
  notes: text('notes').notNull().default(''),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

const lineCols = () => ({
  lineNo: integer('line_no').notNull(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  qty: integer('qty').notNull(),
  freeQty: integer('free_qty').notNull().default(0),
  unitPrice: money('unit_price').notNull(),
  discPct: pct('disc_pct').notNull().default(0),
  lineNet: money('line_net').notNull(),
  unitCost: cost('unit_cost').notNull().default(0),
})

export const salesInvoices = pgTable(
  'sales_invoices',
  {
    id: serial('id').primaryKey(),
    invoiceNo: text('invoice_no').notNull().unique(),
    date: date('date', { mode: 'string' }).notNull(),
    customerId: integer('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
    costTotal: money('cost_total').notNull().default(0),
    ...invoiceMoney(),
  },
  (t) => [index('sales_date_idx').on(t.date), index('sales_customer_idx').on(t.customerId)],
)

export const salesLines = pgTable(
  'sales_lines',
  {
    id: serial('id').primaryKey(),
    invoiceId: integer('invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'cascade' }),
    ...lineCols(),
  },
  (t) => [index('sales_lines_invoice_idx').on(t.invoiceId), index('sales_lines_product_idx').on(t.productId)],
)

export const purchaseInvoices = pgTable(
  'purchase_invoices',
  {
    id: serial('id').primaryKey(),
    invoiceNo: text('invoice_no').notNull(),
    supplierId: integer('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'restrict' }),
    orderNo: text('order_no').notNull().default(''),
    salesPerson: text('sales_person').notNull().default(''),
    date: date('date', { mode: 'string' }).notNull(),
    ...invoiceMoney(),
  },
  (t) => [
    uniqueIndex('purchase_supplier_invoice_uq').on(t.supplierId, t.invoiceNo),
    index('purchase_date_idx').on(t.date),
  ],
)

export const purchaseLines = pgTable(
  'purchase_lines',
  {
    id: serial('id').primaryKey(),
    invoiceId: integer('invoice_id').notNull().references(() => purchaseInvoices.id, { onDelete: 'cascade' }),
    ...lineCols(),
  },
  (t) => [index('purchase_lines_invoice_idx').on(t.invoiceId), index('purchase_lines_product_idx').on(t.productId)],
)

export const payments = pgTable(
  'payments',
  {
    id: serial('id').primaryKey(),
    date: date('date', { mode: 'string' }).notNull(),
    partyType: text('party_type').notNull(),
    customerId: integer('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
    supplierId: integer('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
    amount: money('amount').notNull(),
    method: text('method').notNull(),
    reference: text('reference').notNull().default(''),
    notes: text('notes').notNull().default(''),
    createdAt: created(),
  },
  (t) => [
    check(
      'payments_party_ck',
      sql`(${t.partyType} = 'customer' and ${t.customerId} is not null and ${t.supplierId} is null) or (${t.partyType} = 'supplier' and ${t.supplierId} is not null and ${t.customerId} is null)`,
    ),
    check('payments_amount_ck', sql`${t.amount} > 0`),
    index('payments_date_idx').on(t.date),
  ],
)

export const stockAdjustments = pgTable(
  'stock_adjustments',
  {
    id: serial('id').primaryKey(),
    date: date('date', { mode: 'string' }).notNull(),
    productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    reason: text('reason').notNull(),
    notes: text('notes').notNull().default(''),
    createdAt: created(),
  },
  (t) => [index('adj_product_idx').on(t.productId)],
)
