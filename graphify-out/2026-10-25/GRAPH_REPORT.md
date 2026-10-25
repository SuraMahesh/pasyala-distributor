# Graph Report - pasyala-erp  (2026-10-25)

## Corpus Check
- 110 files · ~95,374 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 931 nodes · 2575 edges · 37 communities (36 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.71)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a5e4720b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_assistant-data.ts|assistant-data.ts]]
- [[_COMMUNITY_types.ts|types.ts]]
- [[_COMMUNITY_scan.ts|scan.ts]]
- [[_COMMUNITY_Purchases.tsx|Purchases.tsx]]
- [[_COMMUNITY_Products.tsx|Products.tsx]]
- [[_COMMUNITY_invoices.ts|invoices.ts]]
- [[_COMMUNITY_catalog.ts|catalog.ts]]
- [[_COMMUNITY_devDependencies|devDependencies]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_dependencies|dependencies]]
- [[_COMMUNITY_InvoiceImages.tsx|InvoiceImages.tsx]]
- [[_COMMUNITY_Layout.tsx|Layout.tsx]]
- [[_COMMUNITY_Reports.tsx|Reports.tsx]]
- [[_COMMUNITY_assistant.test.ts|assistant.test.ts]]
- [[_COMMUNITY_images.ts|images.ts]]
- [[_COMMUNITY_Pricing.tsx|Pricing.tsx]]
- [[_COMMUNITY_schema.ts|schema.ts]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_scripts|scripts]]
- [[_COMMUNITY_rs|rs]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_Pasyala Janith Distributor — ERP|Pasyala Janith Distributor — ERP]]
- [[_COMMUNITY_package.json|package.json]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_Assistant.tsx|Assistant.tsx]]
- [[_COMMUNITY_Dashboard.tsx|Dashboard.tsx]]
- [[_COMMUNITY_compilerOptions|compilerOptions]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_auth.ts|auth.ts]]
- [[_COMMUNITY_.oxlintrc.json|.oxlintrc.json]]
- [[_COMMUNITY_copy-ocr.mjs|copy-ocr.mjs]]
- [[_COMMUNITY_tsconfig.json|tsconfig.json]]

## God Nodes (most connected - your core abstractions)
1. `rs()` - 47 edges
2. `makeTools()` - 31 edges
3. `useConfirm()` - 31 edges
4. `round2()` - 31 edges
5. `todayLK()` - 29 edges
6. `DB` - 28 edges
7. `AssistantData` - 27 edges
8. `useApiMutation()` - 26 edges
9. `transactionRoutes()` - 24 edges
10. `downloadExcel()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `invoiceMoney()` --calls--> `text()`  [INFERRED]
  backend/src/db/schema.ts → shared/src/schemas.ts
- `productsWithStock()` --indirect_call--> `freeQty()`  [INFERRED]
  backend/src/routes/catalog.ts → frontend/src/pages/Stock.tsx
- `imageRoutes()` --indirect_call--> `page()`  [INFERRED]
  backend/src/routes/images.ts → frontend/src/App.tsx
- `scanRoutes()` --indirect_call--> `parties()`  [INFERRED]
  backend/src/routes/scan.ts → frontend/src/App.tsx
- `Settings()` --calls--> `label()`  [INFERRED]
  frontend/src/pages/Settings.tsx → backend/src/services/assistant.ts

## Import Cycles
- None detected.

## Communities (37 total, 1 thin omitted)

### Community 0 - "assistant-data.ts"
Cohesion: 0.05
Nodes (59): batchValue(), productsWithStock(), insightRoutes(), range, today(), customerFilters, customersWithBalance(), partyRoutes() (+51 more)

### Community 1 - "types.ts"
Cohesion: 0.05
Nodes (55): DocParty, InvoiceDocument(), PurchaseRow, SaleRow, amountInWords(), below1000(), CalcLine, intWords() (+47 more)

### Community 2 - "scan.ts"
Cohesion: 0.07
Nodes (54): SEED_PURCHASES, catalog, codeOf, fixture(), read(), truthOf(), bigrams(), buildScanResult() (+46 more)

### Community 3 - "Purchases.tsx"
Cohesion: 0.09
Nodes (38): blankLine(), Draft, DraftLine, emptyDraft(), InvoiceEditor(), newKey(), priceLine(), attachScanPhoto() (+30 more)

### Community 4 - "Products.tsx"
Cohesion: 0.12
Nodes (40): ConfirmFn, ConfirmOptions, Ctx, alignCls(), ClientTable(), Column, DataTable(), DataTableProps (+32 more)

### Community 5 - "invoices.ts"
Cohesion: 0.13
Nodes (43): Executor, Tx, conflict(), notFound(), catalogRoutes(), createProduct(), pricingContext(), byImages() (+35 more)

### Community 6 - "catalog.ts"
Cohesion: 0.05
Nodes (42): sizeRank(), SortVal, productFilters, toProduct(), stockBatches(), AdjustmentInput, adjustmentSchema, BulkPriceInput (+34 more)

### Community 7 - "devDependencies"
Cohesion: 0.05
Nodes (40): dependencies, @anthropic-ai/sdk, compression, cors, drizzle-orm, @electric-sql/pglite, express, helmet (+32 more)

### Community 8 - "index.ts"
Cohesion: 0.13
Nodes (22): ids, today, uploadDir, createApp(), Database, migrationsDir(), openDatabase(), runMigrations() (+14 more)

### Community 9 - "dependencies"
Cohesion: 0.06
Nodes (34): dependencies, lucide-react, pdfjs-dist, @pjd/shared, react, react-dom, react-router-dom, sonner (+26 more)

### Community 10 - "InvoiceImages.tsx"
Cohesion: 0.12
Nodes (30): InvoiceImages(), Lightbox(), PhotoImg(), errorMessage(), base(), imageUrl(), jpeg(), listPhotos() (+22 more)

### Community 11 - "Layout.tsx"
Cohesion: 0.07
Nodes (22): parties(), products(), purchases(), router, sales(), AuthGate(), Login(), LogoutCtx (+14 more)

### Community 12 - "Reports.tsx"
Cohesion: 0.10
Nodes (27): authHeaders(), getToken(), Params, request(), cell(), downloadExcel(), FORMATS, safeSheetName() (+19 more)

### Community 13 - "assistant.test.ts"
Cohesion: 0.18
Nodes (23): batuThel(), DB, customerTypes, payments, anthropicError(), badRequest(), idParam(), assistantRoutes() (+15 more)

### Community 14 - "images.ts"
Cohesion: 0.19
Nodes (21): AppError, parse(), saved, paginate(), col(), imageRoutes(), imagesOf(), invoiceNoOf() (+13 more)

### Community 15 - "Pricing.tsx"
Cohesion: 0.16
Nodes (19): useConfirm(), useApiMutation(), useCustomerTypes(), CustomerForm(), SupplierForm(), Payments(), Edit, GridRow (+11 more)

### Community 16 - "schema.ts"
Cohesion: 0.14
Nodes (19): assistantRequests, cost(), created(), customers, invoiceImages, invoiceMoney(), lineCols(), money() (+11 more)

### Community 17 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+11 more)

### Community 18 - "scripts"
Cohesion: 0.11
Nodes (18): devDependencies, concurrently, engines, node, name, private, scripts, build (+10 more)

### Community 19 - "rs"
Cohesion: 0.19
Nodes (18): Pagination(), Totals(), usePaged(), InvoicePhotos(), blankCustomer(), CustomerDetail(), CustomerList(), SupplierDetail() (+10 more)

### Community 20 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 21 - "Pasyala Janith Distributor — ERP"
Cohesion: 0.12
Nodes (16): AI features with a free OpenRouter key (instead of a paid Anthropic key), API overview (`/api`), Assistant, Deploy to Vercel (free Hobby plan), How the numbers work, Invoice photos, Modules, Pasyala Janith Distributor — ERP (+8 more)

### Community 22 - "package.json"
Cohesion: 0.12
Nodes (15): dependencies, zod, devDependencies, typescript, vitest, exports, main, name (+7 more)

### Community 23 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, allowImportingTsExtensions, esModuleInterop, lib, module, moduleResolution, noEmit, noUnusedLocals (+6 more)

### Community 24 - "Assistant.tsx"
Cohesion: 0.21
Nodes (13): cells(), inline(), isNumericColumn(), isRow(), isSeparator(), Markdown(), Assistant(), QUICK (+5 more)

### Community 25 - "Dashboard.tsx"
Cohesion: 0.20
Nodes (8): Bars(), change(), Dashboard(), DashboardData, dayLabel(), greeting(), SalesChart(), short()

### Community 26 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, lib, module, moduleResolution, noEmit, skipLibCheck, strict (+4 more)

### Community 27 - "vercel.json"
Cohesion: 0.15
Nodes (12): includeFiles, maxDuration, buildCommand, framework, functions, api/index.mjs, headers, installCommand (+4 more)

### Community 28 - "auth.ts"
Cohesion: 0.47
Nodes (9): authEnabled(), authRoutes(), issueToken(), password(), requireAuth(), safeEqual(), secret(), sign() (+1 more)

### Community 29 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 30 - "copy-ocr.mjs"
Cohesion: 0.40
Nodes (3): files, out, require

## Knowledge Gaps
- **303 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+298 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `rs()` connect `rs` to `assistant-data.ts`, `types.ts`, `scan.ts`, `Purchases.tsx`, `Products.tsx`, `invoices.ts`, `Reports.tsx`, `Pricing.tsx`, `Dashboard.tsx`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `todayLK()` connect `assistant-data.ts` to `types.ts`, `Purchases.tsx`, `Products.tsx`, `invoices.ts`, `catalog.ts`, `index.ts`, `Reports.tsx`, `assistant.test.ts`, `Pricing.tsx`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _303 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `assistant-data.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05195968645016797 - nodes in this community are weakly interconnected._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.053410893707033315 - nodes in this community are weakly interconnected._
- **Should `scan.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06545879602571596 - nodes in this community are weakly interconnected._
- **Should `Purchases.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09158249158249158 - nodes in this community are weakly interconnected._