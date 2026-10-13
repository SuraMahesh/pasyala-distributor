import { openDatabase, runMigrations } from './client'
import { isEmpty, seed } from './seed'

const database = await openDatabase()
await runMigrations(database)
if (!(await isEmpty(database.db)) && !process.argv.includes('--force')) {
  console.log('Database already has products — nothing seeded. (Use --force to add missing seed rows.)')
} else {
  await seed(database.db, { withPurchases: await isEmpty(database.db) })
  console.log('Seeded starting data from the 5 Pasyale invoices.')
}
await database.close()
