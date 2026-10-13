// Runs during `vercel build` (and any production build): apply migrations and,
// on an empty database, load the starting data. Skips quietly when no database is configured.
import { openDatabase, runMigrations } from './client'
import { isEmpty, seed } from './seed'

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.log('[db] DATABASE_URL not set — skipping migrations (add it in Vercel → Settings → Environment Variables).')
} else {
  const database = await openDatabase(url)
  await runMigrations(database)
  console.log('[db] migrations applied')
  if (process.env.SEED_ON_EMPTY !== 'false' && (await isEmpty(database.db))) {
    await seed(database.db)
    console.log('[db] empty database — loaded 53 products and the 5 Pasyale invoices')
  }
  await database.close()
}
