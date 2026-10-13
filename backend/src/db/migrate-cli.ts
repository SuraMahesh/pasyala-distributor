import { openDatabase, runMigrations } from './client'

const database = await openDatabase()
await runMigrations(database)
console.log(`Migrations applied (${database.kind}).`)
await database.close()
