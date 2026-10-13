import path from 'node:path'
import { createApp } from './app'
import { openDatabase, runMigrations } from './db/client'
import { isEmpty, seed } from './db/seed'

const port = Number(process.env.PORT ?? 4000)

const database = await openDatabase()
await runMigrations(database)
if (process.env.SEED_ON_EMPTY !== 'false' && (await isEmpty(database.db))) {
  console.log('Empty database — loading starting data from the Pasyale invoices…')
  await seed(database.db)
}

const staticDir = process.env.STATIC_DIR ?? path.resolve(process.cwd(), '../frontend/dist')
const app = createApp(database.db, { log: process.env.NODE_ENV !== 'test', staticDir })
const server = app.listen(port, () => {
  console.log(`API ready on http://localhost:${port}/api  (database: ${database.kind === 'postgres' ? 'PostgreSQL' : 'embedded PGlite at backend/.data'})`)
})

const shutdown = () => {
  server.close(() => void database.close().then(() => process.exit(0)))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
