// Enters handwritten sales bills transcribed into a JSON file (see src/db/imports/) as sales invoices; the
// "RTN" goods a bill carries (its `return` block) go in as sales returns of the same date.
//
//   npm run db:import-sales -- src/db/imports/sales-2026-10.json                         preview only
//   npm run db:import-sales -- src/db/imports/sales-2026-10.json --apply                 write
//   … --apply --photos .data/import-photos/sales-2026-10                                 also attach the bill photos
//   … --apply --photos <dir> --api https://pasyala-backend.vercel.app                    photos through the running
//        site's API (APP_PASSWORD=… in front of the command) when the photo store cannot be written from here
//
// Uses DATABASE_URL from backend/.env (the live database) — run the preview first and read it.
import { readFile } from 'node:fs/promises'
import { rs } from '@pjd/shared'
import { openDatabase } from './client'
import { importSales, type SalesImportFile, type SalesImportOptions, type SalesImportReport } from '../services/import-sales'

const args = process.argv.slice(2)
const valueOf = (flag: string) => {
  const at = args.indexOf(flag)
  if (at < 0) return undefined
  const v = args[at + 1]
  if (!v || v.startsWith('--')) {
    console.error(`${flag} needs a value`)
    process.exit(2)
  }
  return v
}
const flagValues = new Set(['--photos', '--api'].map(valueOf).filter(Boolean))
const file = args.find((a) => !a.startsWith('--') && !flagValues.has(a))
const apply = args.includes('--apply')
const photosDir = valueOf('--photos')
const apiUrl = valueOf('--api')

if (!file) {
  console.error('Usage: npm run db:import-sales -- <file.json> [--apply] [--photos <dir>] [--api <url>]')
  process.exit(2)
}
if (apiUrl && !process.env.APP_PASSWORD) {
  console.error('--api needs the site password: APP_PASSWORD=… npm run db:import-sales -- …')
  process.exit(2)
}
if (apiUrl && !photosDir) {
  console.error('--api only matters together with --photos')
  process.exit(2)
}

const pad = (s: string, n: number) => s.padEnd(n)
const money = (n: number) => rs(n).padStart(12)

function photoNote(i: SalesImportReport['invoices'][number], apply: boolean) {
  if (!i.photos.length) return ''
  if (i.status === 'already entered' || apply) return `  photos ${i.photosAttached}/${i.photos.length} attached`
  return `  photos ${i.photos.length} to attach`
}

function print(r: SalesImportReport) {
  console.log(`\nCustomers (${r.customers.length}):`)
  for (const c of r.customers) {
    const state =
      c.status === 'new' ? (r.apply ? (c.id ? `created #${c.id}` : 'NOT created — its bill was skipped') : 'NEW — will be created') : c.status === 'existing' ? `exists (#${c.id})` : `matched by name to ${c.existingCode} "${c.existingName}" (#${c.id})`
    console.log(`  ${pad(c.code, 16)} ${pad(c.name, 32)} ${pad(c.typeCode, 10)} ${state}`)
  }

  console.log(`\nInvoices (${r.invoices.length}):`)
  for (const i of r.invoices) {
    const state =
      i.status === 'new' ? (r.apply ? `saved as ${i.invoiceNo} (#${i.id})` : 'NEW — matches the bill') : i.status === 'skipped' ? `SKIPPED — ${i.why}` : `already entered as ${i.invoiceNo} (${i.why}) — skipped`
    console.log(`  bill ${pad(i.billNo, 8)} ${i.date}  ${pad(i.customer, 26)} ${String(i.lines).padStart(3)} lines  ${String(i.units).padStart(5)} + ${String(i.freeUnits).padStart(3)} free   gross ${money(i.gross)}   net ${money(i.netTotal)}   ${state}${photoNote(i, r.apply)}`)
  }
  const fresh = r.invoices.filter((i) => i.status === 'new')
  if (fresh.length) {
    const net = fresh.reduce((s, i) => s + i.netTotal, 0)
    const paid = fresh.reduce((s, i) => s + i.paidOnInvoice, 0)
    console.log(`  ${fresh.length} new: net Rs ${rs(net)} — paid on the invoice Rs ${rs(paid)}, due Rs ${rs(net - paid)}`)
  }
  const skipped = r.invoices.filter((i) => i.status === 'skipped')
  if (skipped.length) console.log(`  ${skipped.length} skipped (net Rs ${rs(skipped.reduce((s, i) => s + i.netTotal, 0))}) — fix the cause and run again`)

  if (r.returns.length) {
    console.log(`\nReturns on the bills (${r.returns.length}) — entered as sales returns of the same date:`)
    for (const t of r.returns) {
      const state =
        t.status === 'new' ? (r.apply ? `saved as ${t.returnNo} (#${t.id})` : 'NEW — matches the bill') : t.status === 'skipped' ? `SKIPPED — ${t.why}` : `already entered as ${t.returnNo} (${t.why}) — skipped`
      console.log(`  bill ${pad(t.billNo, 8)} ${t.date}  ${pad(t.customer, 26)} ${String(t.lines).padStart(3)} lines  ${String(t.units).padStart(5)} + ${String(t.freeUnits).padStart(3)} free   gross ${money(t.gross)}   credit ${money(t.netTotal)}   ${t.restock ? 'back on the shelf' : 'written off'}   ${state}`)
    }
    const fresh = r.returns.filter((t) => t.status === 'new')
    if (fresh.length) console.log(`  ${fresh.length} new: Rs ${rs(fresh.reduce((s, t) => s + t.netTotal, 0))} credited to the customers' balances`)
  }

  if (r.stock.length) {
    console.log(`\nStock leaving with the bills / coming back with the returns (${r.stock.length} items):`)
    for (const s of r.stock) console.log(`  ${pad(s.code, 12)} ${pad(s.size, 6)} ${pad(s.name, 32)} on hand ${String(s.onHand).padStart(5)}  −${String(s.units).padStart(4)}  ${s.back ? `+${String(s.back).padStart(3)} back` : '         '}  → ${String(s.after).padStart(5)}${s.after < 0 ? '  SHORT' : ''}`)
  }

  if (r.warnings.length) {
    console.log('\nWarnings:')
    for (const w of r.warnings) console.log(`  - ${w}`)
  }
  const missing = r.invoices.filter((i) => i.photos.length && i.photosAttached < i.photos.length)
  if (r.apply && photosDir && missing.length) console.log(`\n${missing.length} invoice(s) still have photos to attach — fix the cause above and run the same command again.`)
  console.log(r.apply ? '\nDone.' : '\nPREVIEW ONLY — nothing was written. Add --apply to enter these invoices and returns.')
}

const data = JSON.parse(await readFile(file, 'utf8')) as SalesImportFile
const options: SalesImportOptions = { apply, photosDir, ...(apiUrl ? { api: { url: apiUrl, password: process.env.APP_PASSWORD! } } : {}) }
const database = await openDatabase()
try {
  const report = await importSales(database.db, data, options)
  print(report)
} catch (e) {
  console.error(`\nStopped: ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await database.close()
}
