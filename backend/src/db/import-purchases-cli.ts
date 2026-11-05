// Enters supplier invoices transcribed into a JSON file (see src/db/imports/) as purchases/GRNs.
//
//   npm run db:import-purchases -- src/db/imports/purchases-2026-10-21.json                 preview only
//   npm run db:import-purchases -- src/db/imports/purchases-2026-10-21.json --apply         write
//   … --apply --photos .data/import-photos/2026-10-21                                       also attach the page photos
//   … --apply --photos <dir> --api https://pasyala-backend.vercel.app                        attach the photos through the
//        running site's API (needs APP_PASSWORD=… in front of the command) — use this when the photo store
//        cannot be written from this computer (Vercel Blob with OIDC only)
//
// Uses DATABASE_URL from backend/.env (the live database) — run the preview first and read it.
import { readFile } from 'node:fs/promises'
import { rs } from '@pjd/shared'
import { openDatabase } from './client'
import { importPurchases, type ImportFile, type ImportOptions, type ImportReport } from '../services/import-purchases'

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
  console.error('Usage: npm run db:import-purchases -- <file.json> [--apply] [--photos <dir>] [--api <url>]')
  process.exit(2)
}
if (apiUrl && !process.env.APP_PASSWORD) {
  console.error('--api needs the site password: APP_PASSWORD=… npm run db:import-purchases -- …')
  process.exit(2)
}
if (apiUrl && !photosDir) {
  console.error('--api only matters together with --photos')
  process.exit(2)
}

const pad = (s: string, n: number) => s.padEnd(n)
const money = (n: number) => rs(n).padStart(12)

function photoNote(i: ImportReport['invoices'][number], apply: boolean) {
  if (!i.photos.length) return ''
  if (i.status === 'already entered' || apply) return `  photos ${i.photosAttached}/${i.photos.length} attached`
  return `  photos ${i.photos.length} to attach`
}

function print(r: ImportReport) {
  console.log(`\nSupplier: ${r.supplier.name} (${r.supplier.code})`)
  console.log(`\nInvoices (${r.invoices.length}):`)
  for (const i of r.invoices) {
    const state = i.status === 'new' ? (r.apply ? `saved #${i.id}` : 'NEW — matches the printed totals') : `already entered (#${i.id}) — skipped`
    console.log(`  ${i.invoiceNo}  ${i.date}  ${String(i.lines).padStart(3)} lines  ${String(i.units).padStart(5)} + ${String(i.freeUnits).padStart(3)} free   sub ${money(i.subTotal)}   net ${money(i.netTotal)}   ${state}${photoNote(i, r.apply)}`)
  }
  const fresh = r.invoices.filter((i) => i.status === 'new')
  if (fresh.length) {
    console.log(`  Net total of the new invoices: Rs ${rs(fresh.reduce((s, i) => s + i.netTotal, 0))}${fresh[0].paidOnInvoice ? ' — marked as paid on the invoice (Cash)' : ' — unpaid (supplier due)'}`)
  }

  if (r.newProducts.length) {
    console.log(`\nNew products (${r.newProducts.length})${r.apply ? ' created' : ' to create'}:`)
    for (const p of r.newProducts) {
      const code = p.code || `(ERP code)${p.codeStem ? ` — invoice shows …${p.codeStem}` : ''}`
      console.log(`  ${pad(code, 32)} ${pad(p.size, 6)} ${pad(p.name, 32)} ${pad(p.category, 18)} list ${rs(p.listPrice).padStart(10)}  sell ${rs(p.sellPrice).padStart(10)}  disc ${p.supplierDiscPct}%`)
    }
  } else console.log('\nNew products: none — every item already exists')

  if (r.matchedByName.length) {
    console.log(`\nExisting products matched by size + name (the ERP code differs from the invoice):`)
    for (const m of r.matchedByName) console.log(`  ${pad(m.code, 12)} ${pad(m.size, 6)} ${pad(m.name, 32)} invoice code ${m.wanted}`)
  }

  if (r.stock.length) {
    console.log(`\nStock added (${r.stock.length} items, ${r.stock.reduce((s, x) => s + x.units, 0)} units incl. free):`)
    for (const s of r.stock) console.log(`  ${pad(s.code, 12)} ${pad(s.size, 6)} ${pad(s.name, 32)} +${s.units}`)
  }

  if (r.warnings.length) {
    console.log('\nWarnings:')
    for (const w of r.warnings) console.log(`  - ${w}`)
  }
  const missing = r.invoices.filter((i) => i.photos.length && i.photosAttached < i.photos.length)
  if (r.apply && photosDir && missing.length) console.log(`\n${missing.length} invoice(s) still have photos to attach — fix the cause above and run the same command again.`)
  console.log(r.apply ? '\nDone.' : '\nPREVIEW ONLY — nothing was written. Add --apply to enter these invoices.')
}

const data = JSON.parse(await readFile(file, 'utf8')) as ImportFile
const options: ImportOptions = { apply, photosDir, ...(apiUrl ? { api: { url: apiUrl, password: process.env.APP_PASSWORD! } } : {}) }
const database = await openDatabase()
try {
  const report = await importPurchases(database.db, data, options)
  print(report)
} catch (e) {
  console.error(`\nStopped: ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await database.close()
}
