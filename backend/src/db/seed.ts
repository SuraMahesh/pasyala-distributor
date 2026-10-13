// Starting data transcribed from Pasyale Ayurveda Osu (PVT) LTD invoices
// HOSI005920, HOSI005927, HOSI005928, HOSI005942 (2026-10-09) and HOSI005967 (2026-10-10).
import { eq, sql } from 'drizzle-orm'
import { invoiceTotals, type Category, type LineInput } from '@pjd/shared'
import { savePurchase } from '../services/invoices'
import { rows } from '../services/stock'
import type { DB } from './client'
import { customers, customerTypes, products, settings, suppliers } from './schema'

const OIL: Category = 'Thailaya (Oil)'

// [code, size, name, category, supplier list price]
export const SEED_PRODUCTS: [string, string, string, Category, number][] = [
  ['THMN4500', '4.5L', 'MAHA NARAYANA', OIL, 16000],
  ['THNR4500', '4.5L', 'NIRGUNDIYADI', OIL, 16500],
  ['THWV4500', '4.5L', 'WATHA VIDURANGA', OIL, 17000],
  ['THKB4500', '4.5L', 'KEDUMBINDUM', OIL, 15000],
  ['THSU4500', '4.5L', 'SOOLAHARA', OIL, 16000],
  ['THKB0750', '750ML', 'KEDUMBINDUM', OIL, 3200],
  ['THSP0750', '750ML', 'SARSHAPADI', OIL, 3200],
  ['THWP0750', '750ML', 'WISHARPAHARA', OIL, 3800],
  ['THMN0750', '750ML', 'MAHA NARAYANA', OIL, 2900],
  ['THAS0750', '750ML', 'ASHWAGANDA THEL', OIL, 3800],
  ['THMM0750', '750ML', 'MAHAMASHA', OIL, 4300],
  ['THWV0750', '750ML', 'WATHA VIDURANGA', OIL, 3300],
  ['THSU0750', '750ML', 'SOOLAHARA', OIL, 3300],
  ['THEN0750', '750ML', 'NEELYADI', OIL, 2800],
  ['THPN0750', '750ML', 'PINDA', OIL, 3100],
  ['NPAS0375', '375ML', 'ASAMODAGAM SPRIT', 'Arishta / Spirit', 220],
  ['THSV0180', '180ML', 'SARVAVISADI', OIL, 850],
  ['THKU0180', '180ML', 'KUBJAPRASARINI', OIL, 1300],
  ['THMN0180', '180ML', 'MAHA NARAYANA', OIL, 800],
  ['THSP0180', '180ML', 'SARSHAPADI', OIL, 900],
  ['THAS0180', '180ML', 'ASHWAGANDA THEL', OIL, 1000],
  ['THMS0180', '180ML', 'MAHASIDDRTHA', OIL, 850],
  ['THWV0180', '180ML', 'WATHA VIDURANGA', OIL, 850],
  ['THNR0180', '180ML', 'NIRGUNDIYADI', OIL, 850],
  ['THPN0180', '180ML', 'PINDA', OIL, 850],
  ['NPCS-P0100', '100ML', 'PAWATTA WELMEE', 'Other', 400],
  ['THSU0030', '30ML', 'SOOLAHARA', OIL, 200],
  ['ATNE0030', '30ML', 'KOHOMBA THEL', OIL, 200],
  ['ATGN0030', '30ML', 'THALA THEL', OIL, 170],
  ['THBT0030', '30ML', 'BATU THEL', OIL, 200],
  ['THKU0030', '30ML', 'KUBJAPRASARINI', OIL, 300],
  ['THST0030', '30ML', 'SATYAVADI', OIL, 250],
  ['THKB0030', '30ML', 'KEDUMBINDUM', OIL, 200],
  ['ATAB0030', '30ML', 'ABA THEL', OIL, 200],
  ['ATGL0030', '30ML', 'GHEE OIL', OIL, 280],
  ['ATCS0030', '30ML', 'CASTOR OIL', OIL, 200],
  ['ATPS0030', '30ML', 'PAS THEL', OIL, 200],
  ['THWV0030', '30ML', 'WATHA VIDURANGA', OIL, 200],
  ['MSBH0030', '30ML', 'BEE HONEY', 'Honey', 290],
  ['ATME0030', '30ML', 'MEE THEL', OIL, 200],
  ['THKL0030', '30ML', 'KOLASLESMA', OIL, 220],
  ['THMN0030', '30ML', 'MAHA NARAYANA', OIL, 200],
  ['THMS0030', '30ML', 'MAHASIDDRTHA', OIL, 200],
  ['THSP0030', '30ML', 'SARSHAPADI', OIL, 220],
  ['THCM0030', '30ML', 'CAMPHOR/KAPURU', OIL, 250],
  ['GGYG0100', '100g', 'YOGARAJA', 'Guli / Tablets', 1350],
  ['UNRK1000', '1kg', 'ROHANEKASH', 'Other', 6500],
  ['LPLK1000', '1kg', 'LAKSHADI LEPA', 'Lepa / Paste', 5000],
  ['RSDH1000', '1kg', 'DHATHRI RASAYANA', 'Rasayana', 4500],
  ['TBTR1000', '1kg', 'THRIPALA TABLETS', 'Guli / Tablets', 5000],
  ['CHMB0050', '50g', 'MANIBADRA', 'Choorna / Powder', 300],
  ['CHAG0050', '50g', 'ASHWAGANDA CHOORNA', 'Choorna / Powder', 350],
  ['NPPP0030', '30g', 'PASPANGUWA PACKET', 'Other', 90],
]

// [invoiceNo, orderNo, date, [code, qty, free][]]
export const SEED_PURCHASES: [string, string, string, [string, number, number?][]][] = [
  ['HOSI005920', 'HOSO004433', '2026-10-09', [
    ['THMN4500', 2], ['THSU0030', 12, 1], ['ATNE0030', 12, 1], ['ATGN0030', 12, 1], ['THBT0030', 12, 1], ['THNR4500', 1],
    ['THKB0750', 3], ['GGYG0100', 6], ['THKU0030', 36, 3], ['THST0030', 12, 1], ['THKB0030', 12, 1], ['THSV0180', 12], ['THKU0180', 6],
  ]],
  ['HOSI005927', 'HOSO004435', '2026-10-09', [
    ['THWV4500', 1], ['THNR4500', 1], ['THSP0750', 1], ['THWP0750', 1], ['UNRK1000', 1], ['LPLK1000', 1], ['THMN0750', 6],
    ['THAS0750', 4], ['THMM0750', 4], ['THWV0750', 3], ['THSU0750', 3], ['THEN0750', 3], ['THMN0180', 6], ['THSP0180', 6],
    ['THAS0180', 3], ['THMS0180', 3], ['THWV0180', 6], ['THNR0180', 6], ['CHMB0050', 6], ['CHAG0050', 6], ['THKB4500', 1],
  ]],
  ['HOSI005928', 'HOSO004433', '2026-10-09', [['RSDH1000', 50]]],
  ['HOSI005942', 'HOSO004435', '2026-10-09', [['THSU4500', 1], ['THPN0750', 3], ['THPN0750', 6], ['TBTR1000', 1], ['THPN0180', 3]]],
  ['HOSI005967', 'HOSO004461', '2026-10-10', [
    ['NPAS0375', 240, 60], ['ATAB0030', 180, 15], ['THBT0030', 180, 15], ['ATGL0030', 180], ['ATCS0030', 180, 15],
    ['ATPS0030', 240, 20], ['ATGN0030', 240, 20], ['THWV0030', 180, 15], ['MSBH0030', 120], ['ATME0030', 240, 20],
    ['THKL0030', 24, 2], ['ATNE0030', 240, 20], ['THMN0030', 120, 10], ['THMS0030', 60, 5], ['THSP0030', 24, 2],
    ['THCM0030', 24, 2], ['NPCS-P0100', 120, 10], ['NPPP0030', 120],
  ]],
]

/** Totals printed on the paper invoices — the seed must reproduce them exactly. */
export const PRINTED_TOTALS: Record<string, { sub: number; net: number }> = {
  HOSI005920: { sub: 85519.2, net: 78677.66 },
  HOSI005927: { sub: 136383.0, net: 125472.36 },
  HOSI005928: { sub: 175500.0, net: 161460.0 },
  HOSI005942: { sub: 40131.0, net: 36920.52 },
  HOSI005967: { sub: 450964.8, net: 414887.62 },
}

export const SEED_TYPES = [
  { code: 'SHOP', name: 'Shop / Retailer', defaultDiscPct: 0, creditDays: 30, sort: 1 },
  { code: 'MEDICAL', name: 'Medical Center / Clinic', defaultDiscPct: 0, creditDays: 30, sort: 2 },
  { code: 'PHARMACY', name: 'Pharmacy', defaultDiscPct: 0, creditDays: 30, sort: 3 },
  { code: 'WALKIN', name: 'Walk-in / Cash', defaultDiscPct: 0, creditDays: 0, sort: 4 },
]

export async function isEmpty(db: DB) {
  const [r] = await rows<{ n: number }>(db, sql`select count(*)::int as n from products`)
  return Number(r?.n ?? 0) === 0
}

export async function seed(db: DB, opts: { withPurchases?: boolean } = {}) {
  const withPurchases = opts.withPurchases ?? true
  await db
    .insert(settings)
    .values({ id: 1, name: 'Pasyala Janith Distributor', invoicePrefix: 'PJD-', nextInvoiceNo: 1, footerNote: 'Thank you for your business!', supplierCustomerCode: 'DIS000064' })
    .onConflictDoNothing()

  const types = await db.insert(customerTypes).values(SEED_TYPES).onConflictDoNothing().returning()
  const walkinType = types.find((t) => t.code === 'WALKIN') ?? (await db.select().from(customerTypes).where(eq(customerTypes.code, 'WALKIN')))[0]

  const inserted = await db
    .insert(products)
    .values(
      SEED_PRODUCTS.map(([code, size, name, category, price]) => ({
        code, size, name, category,
        listPrice: price,
        supplierDiscPct: 22,
        sellPrice: price, // start at supplier list price (MRP) — adjust in Products / Price lists
        reorderLevel: size === '30ML' || size === '30g' ? 24 : size === '4.5L' ? 1 : 3,
        openingStock: 0,
      })),
    )
    .onConflictDoNothing()
    .returning()
  const idByCode = new Map((inserted.length ? inserted : await db.select().from(products)).map((p) => [p.code, p.id]))

  const [sup] = await db
    .insert(suppliers)
    .values({ code: 'SUP001', name: 'Pasyale Ayurveda Osu (PVT) LTD', phone: '011-4818196', address: '321/3 Pasyale Ayurveda Osu, Dalupitiya Road, Mahara, Kadawatha', creditDays: 0, notes: 'Fax 011-2929444 · info@pasyaleayurveda.com · Our customer code DIS000064' })
    .onConflictDoNothing()
    .returning()

  if (walkinType) {
    await db.insert(customers).values({ code: 'CUS001', name: 'Walk-in Customer', typeId: walkinType.id, creditLimit: 0 }).onConflictDoNothing()
  }

  if (withPurchases && sup) {
    for (const [invoiceNo, orderNo, date, lines] of SEED_PURCHASES) {
      const l: LineInput[] = lines.map(([code, qty, free = 0]) => ({ productId: idByCode.get(code)!, qty, freeQty: free, unitPrice: SEED_PRODUCTS.find((p) => p[0] === code)![4], discPct: 22 }))
      const net = invoiceTotals(l, 8).netTotal
      await savePurchase(db, { invoiceNo, orderNo, date, supplierId: sup.id, salesPerson: 'Sudaraka', payMethod: 'Cash', billDiscPct: 8, paidOnInvoice: net, notes: '', lines: l })
    }
  }
}
