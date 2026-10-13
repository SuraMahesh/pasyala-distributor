// Vercel serverless entry: one Express app handles every /api/* request.
// The database connection is created once per warm function instance and reused.
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Express } from 'express'
import { createApp } from './app'
import { openDatabase } from './db/client'

let appPromise: Promise<Express> | undefined

function getApp() {
  if (!process.env.DB_POOL_MAX) process.env.DB_POOL_MAX = '3' // serverless: keep connections few
  appPromise ??= openDatabase(process.env.DATABASE_URL).then((d) => {
    if (d.kind !== 'postgres') throw new Error('DATABASE_URL is not set in the Vercel project')
    return createApp(d.db)
  })
  appPromise.catch(() => (appPromise = undefined)) // retry on next request after a failure
  return appPromise
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getApp()
    app(req as never, res as never)
  } catch (e) {
    console.error(e)
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: (e as Error).message }))
  }
}
