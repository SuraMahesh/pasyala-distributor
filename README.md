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
   **Invoice photos:** Vercel → Storage → Create → **Blob** → choose **Private** → Connect Project. That adds
   `BLOB_READ_WRITE_TOKEN`; redeploy. (Free plan: 1 GB ≈ 3,000–5,000 invoice pages.)
   For invoice scanning also add `ANTHROPIC_API_KEY` (from console.anthropic.com). Without it, scanning is
   switched off and invoices are typed in as before.
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

## Scanning invoice images

**Sales → New** and **Purchases → New** have a *Scan invoice* box: take a photo (phone) or upload one. Nothing is saved
until you press Save and confirm — the normal invoice form is filled in, with the image, anything unmatched and any
total that does not add up listed at the top. Fix what is wrong, then save.

Two readers:

| | Offline (default, free) | AI (optional) |
|---|---|---|
| Needs | nothing | `ANTHROPIC_API_KEY` on the server |
| Where it runs | in the browser (Tesseract OCR, ~7 MB downloaded once, files served from `/ocr`) | Claude on the server |
| Cost | free | a few US cents per scan |
| Handles | clear photos of printed invoices, any rotation, yellow highlighter | also creased / handwritten / PDF |

The offline reader is tuned for the supplier's layout (`CODE  SIZE NAME  QTY  PRICE  DISC%  AMOUNT`, free items as
0.00 lines). It fixes common OCR mix-ups (O/0, S/5, I/1), checks every line against qty × price − disc = amount, matches
products by code + size + name, fixes the invoice-number prefix from earlier invoices, and uses the supplier's last bill
discount when it cannot read one. Parser tests use real OCR output from the 5 starting invoices (`backend/src/ocr.test.ts`).

Tips for good offline results: lay the page flat, fill the frame with the table, good light, no shadow across the lines.

## Invoice photos

Every sales and purchase invoice has an **Invoice photos** section (one or more pages). Photos are stored in a
private Vercel Blob store (or `backend/.data/uploads` when running on your own computer) and are only served to
logged-in users.

- **Kept with the invoice:** a photo belongs to exactly one invoice (database rule) and is deleted with it.
- **Scanned invoices** keep their photo automatically when saved, turned upright.
- **No mix-ups:** before attaching, the screen asks you to check the invoice number on the paper; the same photo
  (same file) cannot be attached to two invoices; when a scanned photo's invoice number differs from the number
  you typed, saving warns you.
- **Find gaps:** 📎 column and *Photos: missing* filter on the Sales and Purchases lists; the **Invoice photos**
  page shows every photo (search by invoice no, supplier, customer, date) and how many invoices still have none.
- Photos are shrunk in the browser to ~1800 px (≈200–400 KB) plus a small preview. Downloads are named
  `HOSI005967-p1.jpg`.

## PDF invoices and price lists

- **Sales / Purchases → New → Scan:** photos *and* PDF files. A PDF that contains text (e.g. emailed by the
  supplier) is read exactly; a scanned PDF is read page by page with the free text reader. The PDF pages are kept
  with the invoice as photos (up to 10 pages).
- **Invoice photos → Add photo / PDF:** a PDF is attached as one photo per page; the same PDF cannot be attached twice.
- **Products → Scan price list:** upload a supplier price list or invoice (photo or PDF). The review screen lists
  *new products* (name, size, category guessed, supplier code kept as the stock code, prices) and *price changes*
  for products you already have. Tick what you want and Save — new products start with 0 stock.
- Product matching is strict on purpose: an exact code always matches; a code that only looks similar must also
  have the right size and a matching name, so a new product is never mistaken for an existing one.

## Printing

Quick print and Print preview print only the invoice: the browser's own header/footer (page title, web address,
date) is switched off, and the browser tab title follows the company name in Settings.
