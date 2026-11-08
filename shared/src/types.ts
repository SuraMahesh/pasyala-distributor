// API data shapes shared by backend and frontend.

export const CATEGORIES = [
  'Thailaya (Oil)',
  'Arishta / Spirit',
  'Choorna / Powder',
  'Guli / Tablets',
  'Lepa / Paste',
  'Rasayana',
  'Honey',
  'Other',
] as const
export type Category = (typeof CATEGORIES)[number]

export const PAY_METHODS = ['Cash', 'Credit', 'Cheque', 'Bank Transfer'] as const
export type PayMethod = (typeof PAY_METHODS)[number]

export const RETURN_REASONS = ['Damaged', 'Expired', 'Wrong item', 'Unsold stock', 'Other'] as const
export type ReturnReason = (typeof RETURN_REASONS)[number]

/** 'Exchange with distributor' = goods swapped with another Pasyale distributor: a negative qty is what we handed over, a positive qty what we got */
export const ADJ_REASONS = ['Count correction', 'Damage', 'Expired', 'Return', 'Sample', 'Exchange with distributor', 'Other'] as const
export type AdjReason = (typeof ADJ_REASONS)[number]

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface Settings {
  name: string
  address: string
  phone: string
  email: string
  invoicePrefix: string
  nextInvoiceNo: number
  /** sales returns are numbered <prefix>R000001, R000002 … */
  nextReturnNo: number
  footerNote: string
  supplierCustomerCode: string
  allowNegativeStock: boolean
}

export interface CustomerType {
  id: number
  code: string
  name: string
  defaultDiscPct: number
  creditDays: number
  sort: number
  customerCount?: number
}

export interface Product {
  id: number
  code: string
  name: string
  size: string
  category: Category
  listPrice: number
  supplierDiscPct: number
  sellPrice: number
  reorderLevel: number
  openingStock: number
  active: boolean
}

export interface ProductStock {
  opening: number
  purchased: number
  sold: number
  adjusted: number
  /** units customers sent back that went back on the shelf (returns marked "write off" are not counted) */
  returned: number
  onHand: number
  /** cost of one PAID unit (list − supplier discounts); free issues are Rs 0, so the field is the paid price, not an average over free units */
  avgCost: number
  /** units on hand that were bought at the unit price */
  paidOnHand: number
  /** units on hand that came free (unit price 0) */
  freeOnHand: number
  /** free units received from the supplier (unit price 0) */
  freeIn: number
  /** free units given to customers */
  freeOut: number
  /** discount % on the purchase lines (weighted), e.g. 22 */
  lineDiscPct: number
  /** bill discount % on the purchase invoices (weighted), e.g. 8 */
  billDiscPct: number
}

export type ProductWithStock = Product &
  ProductStock & {
    /** paidOnHand × unit price */
    grossValue: number
    /** line + bill discount on grossValue */
    discountValue: number
    /** stock amount after discount (grossValue − discountValue) */
    stockValue: number
    /** true when the stock on hand came from refills with different discounts or prices */
    mixedDisc: boolean
    /** what is left of each GRN (FIFO — oldest sold first), newest first */
    batches: StockBatch[]
    margin: number
  }

export interface StockBatch {
  invoiceId: number | null
  invoiceNo: string
  date: string
  /** charged units of this GRN still on hand */
  qty: number
  /** free units of this GRN still on hand */
  freeQty: number
  unitPrice: number
  lineDiscPct: number
  billDiscPct: number
  /** qty × unit price */
  amount: number
  /** amount after line + bill discount */
  stockAmount: number
}

export interface PriceRule {
  id: number
  productId: number
  customerTypeId: number
  price: number | null
  discPct: number | null
}

export interface Promotion {
  id: number
  name: string
  productId: number
  customerTypeId: number | null
  buyQty: number
  freeQty: number
  startDate: string | null
  endDate: string | null
  active: boolean
}

export interface Customer {
  id: number
  code: string
  name: string
  typeId: number
  phone: string
  address: string
  area: string
  discPct: number | null
  creditLimit: number
  creditDays: number | null
  notes: string
  active: boolean
}

export interface PartyBalance {
  billed: number
  paid: number
  /** sales returns credited to the customer (net of cash refunds); always 0 for suppliers */
  returned: number
  balance: number
  invoices: number
  overdue: number
  oldestDueDate: string | null
}

export type CustomerWithBalance = Customer & PartyBalance & { typeName: string; overLimit: boolean }

export interface Supplier {
  id: number
  code: string
  name: string
  phone: string
  address: string
  creditDays: number
  notes: string
  active: boolean
}
export type SupplierWithBalance = Supplier & PartyBalance & {
  /** bill discount % on this supplier's newest invoice — used as the default for the next GRN */
  lastBillDiscPct: number | null
}

export interface InvoiceLine {
  id?: number
  productId: number
  qty: number
  freeQty: number
  unitPrice: number
  discPct: number
  lineNet?: number
  unitCost?: number
  // joined for display
  code?: string
  name?: string
  size?: string
}

export type InvoiceStatus = 'paid' | 'partial' | 'unpaid'

export interface InvoiceHeader {
  id: number
  invoiceNo: string
  date: string
  payMethod: PayMethod
  billDiscPct: number
  paidOnInvoice: number
  gross: number
  lineDiscount: number
  subTotal: number
  billDiscount: number
  netTotal: number
  notes: string
  /** cheque number when paid by cheque */
  chequeNo: string
  /** date on the cheque — a cheque that is not paid yet falls due on this date */
  chequeDate: string | null
  // derived
  paid: number
  /** part of `paid` that came from sales returns recorded against this invoice (always 0 for purchases) */
  credited: number
  due: number
  status: InvoiceStatus
  dueDate: string
  overdue: boolean
}

export interface SalesInvoice extends InvoiceHeader {
  customerId: number
  customerName: string
  customerTypeName: string
  costTotal: number
  lines: InvoiceLine[]
  /** sales returns recorded against this invoice */
  returns: SalesReturnRef[]
}

export interface SalesReturnRef {
  id: number
  returnNo: string
  date: string
  netTotal: number
  restock: boolean
}

/** Goods a customer sent back (credit note). Stock comes back unless written off; the net total comes off the customer's balance, less any cash refunded. */
export interface SalesReturn {
  id: number
  returnNo: string
  date: string
  customerId: number
  customerName: string
  customerTypeName: string
  /** the invoice the goods were sold on, when known */
  salesInvoiceId: number | null
  invoiceNo: string | null
  reason: ReturnReason
  /** true = back on the shelf; false = damaged / expired, written off (stock unchanged) */
  restock: boolean
  billDiscPct: number
  gross: number
  lineDiscount: number
  subTotal: number
  billDiscount: number
  netTotal: number
  costTotal: number
  /** cash handed back to the customer */
  refunded: number
  refundMethod: PayMethod | ''
  /** netTotal − refunded: what came off the customer's balance */
  credited: number
  notes: string
  lines: InvoiceLine[]
}

export interface PurchaseInvoice extends InvoiceHeader {
  supplierId: number
  supplierName: string
  orderNo: string
  salesPerson: string
  lines: InvoiceLine[]
}

export interface Payment {
  id: number
  date: string
  partyType: 'customer' | 'supplier'
  partyId: number
  partyName?: string
  amount: number
  method: PayMethod
  reference: string
  notes: string
}

export interface StockAdjustment {
  id: number
  date: string
  productId: number
  productLabel?: string
  qty: number
  reason: AdjReason
  notes: string
}

export interface Movement {
  date: string
  type: 'Opening' | 'Purchase' | 'Sale' | 'Return' | 'Adjustment'
  ref: string
  refId: number | null
  party: string
  qtyIn: number
  qtyOut: number
  balance: number
}

export interface StatementRow {
  date: string
  type: 'Invoice' | 'Paid on invoice' | 'Payment' | 'Return' | 'Refund'
  ref: string
  refId: number | null
  debit: number
  credit: number
  balance: number
  note: string
}

export type AlertLevel = 'danger' | 'warning' | 'info'
export interface Alert {
  id: string
  level: AlertLevel
  title: string
  message: string
  link: string
}

export interface PricingContext {
  types: CustomerType[]
  rules: PriceRule[]
  promotions: Promotion[]
}

// ---------------- invoice scanning (photo / PDF → draft invoice)

export type ScanKind = 'sale' | 'purchase'

export interface ScannedLine {
  /** matched product, or null when the line could not be matched — the user picks it */
  productId: number | null
  /** text as printed on the invoice (item code / name / size) */
  rawText: string
  matchedBy: 'ai' | 'code' | 'name' | null
  qty: number
  freeQty: number
  unitPrice: number
  discPct: number
  /** line total printed on the invoice (for checking) */
  printedLineTotal: number | null
}

export interface ScanResult {
  kind: ScanKind
  invoiceNo: string
  date: string | null
  /** matched supplier / customer, or null */
  partyId: number | null
  partyName: string
  orderNo: string
  salesPerson: string
  payMethod: PayMethod | null
  billDiscPct: number
  printedNetTotal: number | null
  lines: ScannedLine[]
  /** things the user should check before saving */
  warnings: string[]
}

// ---------------- which sales used a purchase invoice's stock (FIFO — oldest stock is sold first)

export interface PurchaseUsageSale {
  kind: 'sale' | 'adjustment'
  id: number
  ref: string
  date: string
  party: string
  qty: number
}

export interface PurchaseUsageItem {
  productId: number
  label: string
  /** units this invoice brought in (incl. free) */
  received: number
  /** of those, units already sold / used */
  used: number
  usedBy: PurchaseUsageSale[]
}

export interface PurchaseUsage {
  purchaseId: number
  invoiceNo: string
  used: boolean
  items: PurchaseUsageItem[]
}

// ---------------- photos of the paper invoices

export type ImageInvoiceKind = 'sale' | 'purchase'

export interface InvoiceImage {
  id: number
  kind: ImageInvoiceKind
  invoiceId: number
  invoiceNo: string
  page: number
  size: number
  width: number
  height: number
  /** turn clockwise when showing: 0 / 90 / 180 / 270 */
  rotation: number
  createdAt: string
}

/** gallery row */
export interface InvoiceImageRow extends InvoiceImage {
  date: string
  partyName: string
  netTotal: number
}
