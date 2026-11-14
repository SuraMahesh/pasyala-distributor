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
Settings → *Download full Excel export* gives a readable copy too (one sheet per table). The list pages (Sales, Returns, Purchases, Stock, Products, Payments, Parties, Reports) each have an **Excel** button that downloads what is shown (every page of the current filter), and the Net sales, Discount margin and Stock amount windows download their tables the same way. Every Assistant reply has **Report view**, **Excel** and **PDF** links under it. Report view lays the reply out as a report: business header, the question, a headline tile per table (the total of its key amount), each table with a Total row (added when the assistant left it out) and a bar chart of its key column, then the notes. Excel writes a Report sheet (question, date, the reply's text) plus one sheet per table, named after the heading above the table, with amounts and percentages as numbers and a TOTAL row; PDF opens the same report in the print preview (Print / Save PDF). A question that says "report" (or වාර්තා) and comes back with a table opens the report view by itself. The Sales list also has a checkbox column: tick invoices (or *select all on this page*) to see their net, paid, due and gross profit in a bar above the table and download just those rows. Both Excel buttons on the Sales list first open a column picker (grouped Invoice / Amounts / Payment, with *All* / *None*), so the file holds only the columns you tick; the choice is remembered in the browser for the next download.

**Order requests** (Purchases → Order requests) are the lists of items to order from Pasyale: pick items from the product list, or add an item *by hand* (name, size / variation, quantity) when it is not in the stock list yet; *Add low-stock items* fills in everything at or below its reorder level. A switch shows or hides the prices (the supplier's list price, editable per line) on the printed request, which goes out as a print or PDF with the business header, "To" the supplier and signature lines. Requests are numbered `PJD-PO000001…` with their own counter in Settings, move draft → sent → received (or cancelled), never touch stock or money, and *Enter GRN* opens a new purchase invoice with the request's catalogue items filled in.

Set `APP_PASSWORD` to require a password (always do this on a public server; 8+ characters).

**Security notes.** Login tokens are signed with a random secret the server creates on first start and keeps in the
database (`AUTH_SECRET` overrides it); changing the password logs everyone out. Wrong passwords and wrong owner PINs are
rate-limited per IP. Photo links carry a separate 7-day read-only token, and the request log never records it. The API
refuses cross-origin calls unless `CORS_ORIGIN` lists the sites, and sends a Content Security Policy that allows scripts
from the app itself only. Behind your own reverse proxy set `TRUST_PROXY=1`.

## Deploy to Vercel (free Hobby plan)

The repo is ready for Vercel: the React app is served as static files and `/api/*` runs as one
serverless function (`api/index.mjs` → `backend/src/vercel.ts`). Region is Singapore (`sin1`).
During every deploy the build applies database migrations and, on an empty database, loads the starting data.

1. **Database:** Vercel → Storage → Create Database → Neon (Free, Singapore) → **Connect Project** to this
   project. That adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED` automatically.
2. **Password:** Vercel → Project → Settings → Environment Variables → add `APP_PASSWORD` (Production + Preview).
   **Invoice photos:** Vercel → Storage → Create → **Blob** → choose **Private** → Connect Project. That adds
   `BLOB_READ_WRITE_TOKEN`; redeploy. (Free plan: 1 GB ≈ 3,000–5,000 invoice pages.)
   For the Assistant page add `ANTHROPIC_API_KEY` (or an OpenRouter key, see below). AI invoice scanning is a separate,
   optional `SCAN_API_KEY`; without it invoices are read on the device with the built-in offline OCR.
3. Deploy, either:
   - **GitHub:** push this folder to a private repo → Vercel → Add New → Project → Import. Leave the build
     settings as they are (they come from `vercel.json`).
   - **CLI:** `npm i -g vercel` → `vercel login` → `vercel` (first time, creates the project) → `vercel --prod`.

Changing `APP_PASSWORD` later logs everyone out. Redeploy after changing environment variables.

### AI features with a free OpenRouter key (instead of a paid Anthropic key)

The Assistant (and optional AI invoice scanning) use the Anthropic SDK. OpenRouter offers an Anthropic-compatible
endpoint, so the same code can run on OpenRouter's **free** models — set, in `backend/.env` (or Vercel → Environment Variables):

```bash
ANTHROPIC_API_KEY=sk-or-v1-…                        # your OpenRouter key (openrouter.ai/settings/keys) — the Assistant
ANTHROPIC_BASE_URL=https://openrouter.ai/api        # send requests to OpenRouter, not api.anthropic.com
ASSISTANT_MODEL=nvidia/nemotron-3.5-super-vl:free   # any free model that supports tools
# optional AI invoice scanning (otherwise invoices are read on the device with the offline OCR):
# SCAN_API_KEY=sk-or-v1-…                           # may be the same key
# ANTHROPIC_MODEL=nvidia/nemotron-3.5-super-vl:free # for scanning: a free model with tools AND image input
```

Restart the server after changing these. Free models are slower and less accurate than Claude, and OpenRouter
rate-limits them (about 20 requests a minute plus a daily cap; one assistant question makes several requests), so
expect "rate-limiting" messages at busy times. Remove `ANTHROPIC_BASE_URL` to go back to Anthropic with an `sk-ant-…` key.

## Tests

```bash
npm test                                   # shared maths + full API suite (embedded Postgres)
TEST_DATABASE_URL=postgres://… npm test -w backend   # same suite on a real PostgreSQL database (it is wiped!)
```

136 tests (117 backend + 19 shared maths) cover: the payment-method filter on the sales list, the RTN goods on a bill entered as sales returns by the importer, the supplier bill discount on the sales list, sale costs on charged units only (free items at Rs 0 on both sides) and the re-cost command, the discount margin on the sales list, exchanges with other distributors, cheques not yet paid (cheque date as due date, cheque cleared), sales returns (stock back or written off, credit against the invoice, refunds, delete guards, reports net of returns), the 5 seeded invoices reproducing the printed sub/net totals to the cent, landed cost with
free issues, customer-type / customer / product pricing priority, promotions, invoice numbering, oversell
protection (and no number used up on failure), edit/delete returning stock, FIFO payment allocation,
overdue & aging, credit-limit and below-cost warnings, duplicate supplier invoices, adjustments, delete
protection, pagination and report totals, login/image tokens and rate limits, tamper-proof assistant history, invoice photos
(real image type, duplicates, page numbering), the assistant's data tools, and the input-validation messages.

## How the numbers work

| | |
|---|---|
| Line amount | qty × unit price × (1 − disc %), rounded to cents |
| Net total | sub total − bill discount % |
| Landed cost / unit | line net × (1 − bill disc %) ÷ paid qty — 71.76% of list at 22% + 8%. Free issues cost Rs 0: they add stock and never dilute this price |
| Stock on hand | opening + purchased (incl. free) − sold (incl. free) + returned by customers (restocked) ± adjustments |
| Stock amount (Stock page) | charged units on hand × the unit price on the GRN they came from, less that GRN's line (22%) and bill (8%) discounts; free units count in the quantity at Rs 0; stock is taken oldest first so what is on hand is the newest refills — click the Amount tile for the ladder (at list → less discounts → stock amount, plus the value at selling prices) and the item-by-item table |
| Sales return | priced as sold; comes off the customer's balance (the invoice it names first, else the oldest unpaid), less any cash refunded; sales reports are net of returns |
| Sale cost / profit | charged units × the paid unit price; free items are outside the margin maths on both sides (free issues received cost Rs 0, free units given to a shop cost Rs 0 — they only move stock). The unit cost is saved on each sales line when the invoice is saved; `npm run db:recost-sales -- --apply` (from `backend/`) re-costs older invoices at today's paid unit price |
| Invoice due | paid on the invoice is applied to that invoice; separate payments go to the **oldest** unpaid invoices first |
| Overdue | unpaid after the credit days (customer → customer type) |
| Net sales (Sales list) | the invoice totals after the customers' discounts: gross (list × qty) less the discount given. Payments do not change it (Paid / Due show what has been collected); returns are credited against the invoice, and Reports shows sales net of returns — click the figure for the ladder (total at list price → less the supplier's 22% item discount → less the supplier's 8% bill discount on the remainder, giving the goods at the supplier's net price → less the discount given → net sales) and the invoice-by-invoice table with the same columns plus paid and due. The 8% is the bill discount on the newest GRN |
| Discount margin (Sales list) | discount given to the customer (gross − net) less the supplier's item discount on the same goods (22% of gross): 8% of gross for a 30% customer, 13% for 35%. The Purchases list shows the supplier's 8% **bill** discount, which is what funds it — click either figure for the invoice-by-invoice table |
| Cheque | a cheque marked **Not yet paid** keeps the invoice due and makes it fall due on the cheque date; **Cheque cleared** on the invoice page then marks the invoice paid (on the invoice itself, not a FIFO payment). A cheque marked **Paid** settles the invoice at once. *Sales → Cheque not cleared* lists the cheques still out, and the **payment method** filter next to it shows only the credit (on account), cash, cheque or bank-transfer sales |

### Pricing for shops vs medical centers

1. **Product price for the customer type** (fixed price or discount %) — *Prices & discounts → Product prices*
2. else the **customer's own discount %** — on the customer
3. else the **customer type default discount %** — *Prices & discounts → Customer types*
4. **Free issues** (buy X get Y, optionally for one type and date range) fill the Free column automatically.

Anything can still be changed on the invoice line. The sale is checked against stock, credit limit and cost.

## Modules

Dashboard · Sales invoices (print preview A4/A5) · Sales returns (credit notes) · Shops & customers (types, credit limits, statements) ·
Prices & discounts (types, price grid, free issues, printable price lists) · Products · Stock (adjustments,
exchanges with other distributors, movements) · Purchases/GRN · Suppliers · Payments · Reports (product, customer, customer type, daily,
aging) · Settings · Notifications (out/low stock, overdue, over limit, supplier dues, promotions ending).

All lists are paginated on the server (10/25/50/100 per page), sortable, searchable, and turn into cards on phones.

## API overview (`/api`)

`products`, `products/options`, `products/:id`, `products/:id/movements`, `products/bulk-price`,
`customer-types`, `price-rules`, `price-list?typeId=`, `promotions`, `pricing/context`,
`customers`, `customers/:id`, `suppliers`, `suppliers/:id`,
`sales`, `sales/:id`, `sales-returns`, `sales-returns/:id`, `purchases`, `purchases/:id`, `order-requests`, `order-requests/:id` (+ `/flags`, `/suggestions`), `payments`, `adjustments`,
`reports/summary|by-product|by-customer|by-type|daily|aging`, `dashboard`, `alerts`, `settings`, `export`.
List endpoints accept `page`, `pageSize`, `search`, `sort`, `dir` and return `{ items, total, page, pageSize, summary }`.

## Sales returns

When a shop sends goods back, open the invoice and press **Return items** (or *Sales → Returns → New return*).
The lines of that invoice appear priced as they were sold; type the quantity that came back on each one.
A return can also be entered without an invoice (a general return priced at the customer's usual price).

- **Back into stock** puts the units back on the shelf (they show as *Return* in the product's movements);
  **Write off** records damaged or expired goods — stock does not change and the cost is lost.
- The return total comes off the customer's balance: against the invoice it names first, otherwise against
  the oldest unpaid invoices. Cash handed back is entered as **Refunded** and does not reduce the balance.
- A return never takes back more than the invoice sold, and that invoice cannot be deleted (or edited below
  the returned quantity) while the return exists. Deleting a restocked return is refused once its goods were sold on.
- Returns are numbered `PJD-R000001`, … (prefix from Settings, own counter). Every sales figure — dashboard,
  reports, assistant — is net of returns; the Reports page shows the returned amount next to Sales.

## Scanning invoice images

**Sales → New** and **Purchases → New** have a *Scan invoice* box: take a photo (phone) or upload one. Nothing is saved
until you press Save and confirm — the normal invoice form is filled in, with the image, anything unmatched and any
total that does not add up listed at the top. Fix what is wrong, then save.

Two readers:

| | Offline (default, free) | AI (optional) |
|---|---|---|
| Needs | nothing | `SCAN_API_KEY` on the server (separate from the Assistant's key) |
| Where it runs | in the browser (Tesseract OCR, ~7 MB downloaded once, files served from `/ocr`) | Claude on the server |
| Cost | free | a few US cents per scan |
| Handles | clear photos of printed invoices, any rotation, yellow highlighter | also creased / handwritten / PDF |

The offline reader is tuned for the supplier's layout (`CODE  SIZE NAME  QTY  PRICE  DISC%  AMOUNT`, free items as
0.00 lines). It fixes common OCR mix-ups (O/0, S/5, I/1), checks every line against qty × price − disc = amount, matches
products by code + size + name, fixes the invoice-number prefix from earlier invoices, and uses the supplier's last bill
discount when it cannot read one. Parser tests use real OCR output from the 5 starting invoices (`backend/src/ocr.test.ts`).

Tips for good offline results: lay the page flat, fill the frame with the table, good light, no shadow across the lines.

## Entering paper invoices in bulk

For a batch of supplier invoices typed into a JSON file (`backend/src/db/imports/` has one file per delivery
date), the importer checks every invoice against the totals printed on the paper, matches
products by the supplier's code or by size + name, creates the ones the ERP does not have, and can attach the page
photos:

```bash
cd backend
npm run db:import-purchases -- src/db/imports/purchases-2026-10-21.json                 # preview only
npm run db:import-purchases -- src/db/imports/purchases-2026-10-21.json --apply --photos .data/import-photos/2026-10-21
```

Nothing is written unless `--apply` is given and every invoice adds up. Running it again skips invoices already entered
and only adds photos to invoices that still have none. When the photo store cannot be written from your computer (a
Vercel Blob store set to OIDC only), add `--api https://your-site.vercel.app` with `APP_PASSWORD=…` in front of the
command: the photos then go through the running site's own API.

Handwritten **sales** bills work the same way with `npm run db:import-sales -- src/db/imports/sales-2026-10.json`
(preview, then `--apply`, optionally `--photos <dir>`): customers in the file are matched by code or a similar name
and created when new, products must already exist, every bill must reproduce its written gross and net totals, the
stock that would leave is shown against what is on hand, and the ERP gives each sale its own PJD number (the paper
bill number is kept in the invoice notes). A bill can carry a `return` block — the "RTN" goods the shop handed back
on the same visit, with their written gross and credit — which goes in as a sales return of the same date (stock
back on the shelf, the credit off the shop's balance), so a later bill in the file can sell what an earlier one
took back. See `sales-2026-11-04b.json` (bill 189773).

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

## Assistant

**Assistant** in the menu is a chat over the whole ERP, for the owner and staff, in English or Sinhala:

- **Stock** — "How many 30ml Batu Thel do we have, and when did we last get it?", "What is running low?", "What should I reorder?",
  "What is not selling?", "What is our stock worth?"
- **Sales and purchases** — "Sales yesterday", "What did Asiri Pharmacy buy last month?", "Show invoice PJD-000012", "Show GRN HOSI005967",
  "Top products this month", "Sales by customer type"
- **Money** — "Who owes us money?", "Which customers are overdue?", "Aging report", "What do we owe the supplier?", "Payments received this week"
- **Prices** — "Price of 750ml Pinda for a pharmacy", "Which promotions are running?"
- **Decisions** — "How is business this month?", "Anything I should worry about today?" — the assistant fetches the figures, then suggests
  (what to order, whom to call, what to stop stocking) and says which assumption it used (e.g. the sales rate of the last 30 days).

Every number comes from the same functions as the screens (`productsWithStock`, `customerDues`, `services/reports.ts` …), so the assistant
can never disagree with the Stock, Customers or Reports pages. The model never calculates stock or balances itself.

Needs `ANTHROPIC_API_KEY` (`ASSISTANT_MODEL` optional, default `claude-opus-5-5`; invoice scanning has its own `SCAN_API_KEY`). The assistant **cannot change the ERP**:
asking it to fix a count creates a **pending request**; the owner approves or rejects it on the same page with `OWNER_PIN`, and only then is a
stock adjustment posted (visible under Stock → Adjustments with the request number). For anything else it points to the right page.
Code: `backend/src/services/assistant.ts` (tools + prompt), `assistant-data.ts` (reads), `assistant-approvals.ts` (owner approval),
`routes/assistant.ts`, `frontend/src/pages/Assistant.tsx`. Tests: `backend/src/assistant.test.ts`.

## Printing

Quick print and Print preview print only the invoice: the browser's own header/footer (page title, web address,
date) is switched off, and the browser tab title follows the company name in Settings.
