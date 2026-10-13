import { APP_VERSION } from '@pjd/shared'
import { existsSync } from 'node:fs'
import path from 'node:path'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { authRoutes, requireAuth } from './auth'
import type { DB } from './db/client'
import { errorHandler } from './errors'
import { catalogRoutes } from './routes/catalog'
import { insightRoutes } from './routes/insights'
import { partyRoutes } from './routes/parties'
import { transactionRoutes } from './routes/transactions'

export function createApp(db: DB, opts: { log?: boolean; staticDir?: string; corsOrigin?: string } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet({ contentSecurityPolicy: false }))
  app.use(compression())
  app.use(cors({ origin: opts.corsOrigin ?? process.env.CORS_ORIGIN ?? true }))
  app.use(express.json({ limit: '2mb' }))
  if (opts.log) app.use(morgan('dev'))

  const api = express.Router()
  api.get('/health', (_req, res) => {
    res.json({ ok: true, version: APP_VERSION })
  })
  api.use(authRoutes())
  api.use(requireAuth)
  api.use(catalogRoutes(db))
  api.use(partyRoutes(db))
  api.use(transactionRoutes(db))
  api.use(insightRoutes(db))
  api.use((_req, res) => {
    res.status(404).json({ error: 'API route not found' })
  })
  app.use('/api', api)

  // In production the backend also serves the built frontend (single deploy)
  const dir = opts.staticDir
  if (dir && existsSync(path.join(dir, 'index.html'))) {
    app.use(express.static(dir, { maxAge: '1h', index: false }))
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dir, 'index.html')))
  }

  app.use(errorHandler)
  return app
}
