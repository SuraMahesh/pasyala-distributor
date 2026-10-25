import { APP_VERSION } from '@pjd/shared'
import { existsSync } from 'node:fs'
import path from 'node:path'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { authRoutes, initAuth, requireAuth, warnAboutWeakAuth } from './auth'
import type { DB } from './db/client'
import { errorHandler } from './errors'
import { assistantRoutes } from './routes/assistant'
import { catalogRoutes } from './routes/catalog'
import { imageRoutes } from './routes/images'
import { insightRoutes } from './routes/insights'
import { partyRoutes } from './routes/parties'
import { scanRoutes } from './routes/scan'
import { transactionRoutes } from './routes/transactions'
import type { InvoiceScanner } from './services/scan'

export function createApp(db: DB, opts: { log?: boolean; staticDir?: string; corsOrigin?: string; scanner?: InvoiceScanner | null } = {}) {
  const app = express()
  app.disable('x-powered-by')
  // behind Vercel / Nginx the client IP is in X-Forwarded-For; the login rate limiter needs the real one
  app.set('trust proxy', process.env.TRUST_PROXY ?? (process.env.VERCEL ? 1 : false))
  initAuth(db).catch((e) => console.error('[auth] could not initialise the login secret:', e))
  warnAboutWeakAuth()
  app.use(
    helmet({
      // scripts only from this origin (plus wasm + blob workers for the in-browser OCR and PDF reader); no inline scripts
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'blob:'],
          workerSrc: ["'self'", 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'blob:', 'data:'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
    }),
  )
  app.use(compression())
  // the web app is served from this same origin, so cross-origin API access is off unless CORS_ORIGIN lists the sites
  const corsOrigin = opts.corsOrigin ?? process.env.CORS_ORIGIN
  app.use(cors({ origin: corsOrigin ? corsOrigin.split(',').map((s) => s.trim()) : false }))
  app.use(express.json({ limit: '6mb' }))
  if (opts.log) {
    // like morgan's "dev" format, but the image token in photo links (?t=…) never reaches the log
    morgan.token('url-redacted', (req) => ((req as express.Request).originalUrl ?? req.url ?? '').replace(/([?&]t=)[^&]*/g, '$1…'))
    app.use(morgan(':method :url-redacted :status :response-time ms - :res[content-length]'))
  }

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
  api.use(assistantRoutes(db))
  api.use(imageRoutes(db))
  api.use(opts.scanner === undefined ? scanRoutes(db) : scanRoutes(db, opts.scanner))
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
