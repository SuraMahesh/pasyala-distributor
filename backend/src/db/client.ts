import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import * as schema from './schema'

export type DB = NodePgDatabase<typeof schema>
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
export type Executor = DB | Tx

// numeric/bigint from raw SQL come back as strings — return plain JS numbers instead
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)))
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)))
// keep DATE as 'yyyy-mm-dd' (no timezone shifting)
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v)

export interface Database {
  db: DB
  kind: 'postgres' | 'pglite'
  close: () => Promise<void>
}

/** Finds backend/drizzle whether running from src (tsx) or dist (bundled). */
export function migrationsDir() {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'drizzle')
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate
    dir = path.dirname(dir)
  }
  throw new Error('Could not find the drizzle migrations folder')
}

/**
 * DATABASE_URL set  → real PostgreSQL (production).
 * DATABASE_URL unset → embedded PostgreSQL (PGlite) stored in backend/.data — zero-setup for development.
 */
export async function openDatabase(url = process.env.DATABASE_URL): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) })
    const db = drizzlePg(pool, { schema })
    return { db, kind: 'postgres', close: () => pool.end() }
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle: drizzleLite } = await import('drizzle-orm/pglite')
  const dataDir = process.env.PGLITE_DIR ?? path.resolve(process.cwd(), '.data/pglite')
  if (dataDir !== 'memory://') mkdirSync(dataDir, { recursive: true })
  const client = new PGlite(dataDir, {
    parsers: {
      1700: (v: string) => Number(v), // numeric
      20: (v: string) => Number(v), // int8
      1082: (v: string) => v, // date
    },
  })
  const db = drizzleLite(client, { schema }) as unknown as DB
  return { db, kind: 'pglite', close: () => client.close() }
}

export async function runMigrations(database: Database) {
  const folder = migrationsDir()
  if (database.kind === 'postgres') {
    await migratePg(database.db, { migrationsFolder: folder })
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(database.db as never, { migrationsFolder: folder })
  }
}
