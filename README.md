# Pasyala Janith Distributor — ERP

Sales, stock, pricing and credit management for an Ayurveda products distributor
that buys from Pasyale Ayurveda Osu and sells to **shops, medical centers, pharmacies and walk-in customers**.

```
pasyala-erp/
├── shared/     calculations, pricing rules, FIFO dues, validation (used by BOTH sides)
├── backend/    Node + Express + PostgreSQL (Drizzle ORM) REST API
└── frontend/   React + TypeScript + Tailwind CSS (Vite)
```

## Quick start (development)

Needs **Node 22+**.

```bash
npm install
npm run dev          # API on :4000 + web app on http://localhost:5173
```

With no `DATABASE_URL`, the API uses an **embedded PostgreSQL** (PGlite) stored in `backend/.data/` — nothing else to install.
On first start it loads the 53 products and the 5 Pasyale invoices (HOSI005920 … HOSI005967) as purchases.

### Use a real PostgreSQL server (recommended for real use)

```bash
docker compose up -d                       # or install PostgreSQL 16 yourself
cp backend/.env.example backend/.env       # DATABASE_URL=postgres://pjd:pjd@localhost:5432/pjd_erp
npm run dev
```

Migrations run automatically on start (`npm run db:migrate` to run them by hand).

## Production

```bash
npm install
npm run build        # builds frontend/dist and backend/dist
npm start            # one Node process: API at /api + the web app, port 4000
```

Set `DATABASE_URL`, `PORT` in `backend/.env` (or the environment). Put it behind Nginx/Caddy with HTTPS.
To host the frontend separately (Netlify, Vercel …) set `VITE_API_URL` when building it and `CORS_ORIGIN` on the API.

**Backups:** `pg_dump -Fc pjd_erp > pjd_erp-$(date +%F).dump` daily (restore with `pg_restore`).
Settings → *Download full Excel export* gives a readable copy too (one sheet per table).

Set `APP_PASSWORD` to require a password (always do this on a public server).

## Deploy to Vercel (free Hobby plan)

The repo is ready for Vercel: the React app is served as static files and `/api/*` runs as one
serverless function (`api/index.mjs` → `backend/src/vercel.ts`). Region is Singapore (`sin1`).
During every deploy the build applies database migrations and, on an empty database, loads the starting data.

1. **Database:** Vercel → Storage → Create Database → Neon (Free, Singapore) → **Connect Project** to this
   project. That adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically.
2. **Password:** Vercel → Project → Settings → Environment Variables → add `APP_PASSWORD` (Production + Preview).
3. Deploy, either:
   - **GitHub:** push this folder to a private repo → Vercel → Add New → Project → Import. Leave the build
     settings as they are (they come from `vercel.json`).
   - **CLI:** `npm i -g vercel` → `vercel login` → `vercel` (first time, creates the project) → `vercel --prod`.

Changing `APP_PASSWORD` later logs everyone out. Redeploy after changing environment variables.

## Tests

```bash
npm test                                   # shared maths + full API suite (embedded Postgres)
TEST_DATABASE_URL=postgres://… npm test -w backend   # same suite on a real PostgreSQL database (it is wiped!)
```

38 tests cover: the 5 seeded invoices reproducing the printed sub/net totals to the cent, landed cost with
free issues, customer-type / customer / product pricing priority, promotions, invoice numbering, oversell
protection (and no number used up on failure), edit/delete returning stock, FIFO payment allocation,
overdue & aging, credit-limit and below-cost warnings, duplicate supplier invoices, adjustments, delete
protection, pagination and report totals.

## How the numbers work

| | |
|---|---|
| Line amount | qty × unit price × (1 − disc %), rounded to cents |
| Net total | sub total − bill discount % |
| Landed cost / unit | Σ line net × (1 − bill disc %) ÷ Σ (qty + free) — free issues lower your cost |
| Stock on hand | opening + purchased (incl. free) − sold (incl. free) ± adjustments |
| Sale cost / profit | cost per unit is saved on each sales line when the invoice is saved |
| Invoice due | paid on the invoice is applied to that invoice; separate payments go to the **oldest** unpaid invoices first |
| Overdue | unpaid after the credit days (customer → customer type) |

### Pricing for shops vs medical centers

1. **Product price for the customer type** (fixed price or discount %) — *Prices & discounts → Product prices*
2. else the **customer's own discount %** — on the customer
3. else the **customer type default discount %** — *Prices & discounts → Customer types*
4. **Free issues** (buy X get Y, optionally for one type and date range) fill the Free column automatically.

Anything can still be changed on the invoice line. The sale is checked against stock, credit limit and cost.

## Modules

Dashboard · Sales invoices (print preview A4/A5) · Shops & customers (types, credit limits, statements) ·
Prices & discounts (types, price grid, free issues, printable price lists) · Products · Stock (adjustments,
movements) · Purchases/GRN · Suppliers · Payments · Reports (product, customer, customer type, daily,
aging) · Settings · Notifications (out/low stock, overdue, over limit, supplier dues, promotions ending).

All lists are paginated on the server (10/25/50/100 per page), sortable, searchable, and turn into cards on phones.

## API overview (`/api`)

`products`, `products/options`, `products/:id`, `products/:id/movements`, `products/bulk-price`,
`customer-types`, `price-rules`, `price-list?typeId=`, `promotions`, `pricing/context`,
`customers`, `customers/:id`, `suppliers`, `suppliers/:id`,
`sales`, `sales/:id`, `purchases`, `purchases/:id`, `payments`, `adjustments`,
`reports/summary|by-product|by-customer|by-type|daily|aging`, `dashboard`, `alerts`, `settings`, `export`.
List endpoints accept `page`, `pageSize`, `search`, `sort`, `dir` and return `{ items, total, page, pageSize, summary }`.
