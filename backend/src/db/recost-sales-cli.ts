// Re-costs every sales invoice: charged units at the paid unit price, free items at Rs 0 on both sides.
//
//   npm run db:recost-sales              preview: which invoices change and by how much
//   npm run db:recost-sales -- --apply   rewrite the saved costs
//
// Uses DATABASE_URL from backend/.env (the live database) — run the preview first.
import { rs } from '@pjd/shared'
import { openDatabase } from './client'
import { productsWithStock } from '../routes/catalog'
import { recostSales } from '../services/recost'
import { rows } from '../services/stock'

const apply = process.argv.includes('--apply')
const database = await openDatabase()
try {
  const r = await recostSales(database.db, apply)
  console.log(`\n${r.invoices} sales invoices · cost of goods sold ${rs(r.oldCost)} → ${rs(r.newCost)} (${r.changed} invoice(s) change)`)
  for (const x of r.rows.slice(0, 60)) console.log(`  ${x.invoiceNo}  ${x.date}  ${rs(x.oldCost).padStart(12)} → ${rs(x.newCost).padStart(12)}`)
  if (r.rows.length > 60) console.log(`  … and ${r.rows.length - 60} more`)
  if (r.returns) console.log(`${r.returns} sales return(s), ${r.returnsChanged} line cost(s) change`)
  const [pu] = await rows<{ net: number }>(database.db, (await import('drizzle-orm')).sql`select coalesce(sum(net_total), 0) as net from purchase_invoices`)
  const stockValue = (await productsWithStock(database.db)).reduce((s, p) => s + p.stockValue, 0)
  console.log(`\nCheck: purchases ${rs(pu.net)} vs sold at cost ${rs(r.newCost)} + stock on hand ${rs(stockValue)} = ${rs(r.newCost + stockValue)}`)
  console.log('  (free items are outside the cost: the two sides differ by the paid price of any charged units that physically came from free stock)')
  console.log(apply ? '\nDone — costs rewritten.' : '\nPREVIEW ONLY — nothing was written. Add --apply to rewrite the costs.')
} finally {
  await database.close()
}
