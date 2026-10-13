import { round2 } from './calc'
import type { Customer, CustomerType, PriceRule, Product, Promotion } from './types'

export type PriceSource = 'product-rule-price' | 'product-rule-disc' | 'customer' | 'customer-type' | 'none'

export interface PriceQuote {
  unitPrice: number
  discPct: number
  netUnitPrice: number
  source: PriceSource
  sourceLabel: string
  promotion: Promotion | null
  freeQty: number
}

/**
 * Selling price for one product to one customer.
 * Priority (first match wins):
 *   1. price rule for this product + customer type  (fixed price, or a discount %)
 *   2. customer's own discount %                     (set on the customer)
 *   3. customer type default discount %             (e.g. Shop 15%, Medical Center 20%)
 * Free issue: best active promotion for the product (type-specific beats "all types").
 */
export function quotePrice(args: {
  product: Pick<Product, 'id' | 'sellPrice'>
  customer?: Pick<Customer, 'typeId' | 'discPct'> | null
  types: CustomerType[]
  rules: PriceRule[]
  promotions: Promotion[]
  qty: number
  date: string
}): PriceQuote {
  const { product, customer, types, rules, promotions, qty, date } = args
  const type = customer ? types.find((t) => t.id === customer.typeId) : undefined
  let unitPrice = product.sellPrice
  let discPct = 0
  let source: PriceSource = 'none'
  let sourceLabel = 'Base selling price'

  const rule = type ? rules.find((r) => r.productId === product.id && r.customerTypeId === type.id) : undefined
  if (rule && rule.price != null) {
    unitPrice = rule.price
    discPct = 0
    source = 'product-rule-price'
    sourceLabel = `${type!.name} special price`
  } else if (rule && rule.discPct != null) {
    discPct = rule.discPct
    source = 'product-rule-disc'
    sourceLabel = `${type!.name} product discount`
  } else if (customer && customer.discPct != null) {
    discPct = customer.discPct
    source = 'customer'
    sourceLabel = 'Customer discount'
  } else if (type && type.defaultDiscPct) {
    discPct = type.defaultDiscPct
    source = 'customer-type'
    sourceLabel = `${type.name} discount`
  }

  const promotion = bestPromotion(promotions, product.id, type?.id ?? null, date)
  const freeQty = promotion ? freeQtyFor(promotion, qty) : 0

  return {
    unitPrice,
    discPct,
    netUnitPrice: round2(unitPrice * (1 - discPct / 100)),
    source,
    sourceLabel,
    promotion,
    freeQty,
  }
}

export function promotionActive(p: Promotion, date: string) {
  return p.active && (!p.startDate || p.startDate <= date) && (!p.endDate || p.endDate >= date)
}

export function bestPromotion(promotions: Promotion[], productId: number, typeId: number | null, date: string) {
  const list = promotions.filter(
    (p) => p.productId === productId && promotionActive(p, date) && (p.customerTypeId == null || p.customerTypeId === typeId),
  )
  // specific to this customer type first, then most generous ratio
  list.sort((a, b) => {
    const spec = Number(b.customerTypeId != null) - Number(a.customerTypeId != null)
    return spec || b.freeQty / b.buyQty - a.freeQty / a.buyQty
  })
  return list[0] ?? null
}

export const freeQtyFor = (p: Pick<Promotion, 'buyQty' | 'freeQty'>, qty: number) =>
  p.buyQty > 0 ? Math.floor(qty / p.buyQty) * p.freeQty : 0
