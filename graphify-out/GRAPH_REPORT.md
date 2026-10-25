# Graph Report - pasyala-erp  (2026-10-25)

## Corpus Check
- 112 files · ~104,121 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 963 nodes · 2669 edges · 41 communities (40 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.71)
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
- [[_COMMUNITY_InvoiceEditor.tsx|InvoiceEditor.tsx]]
- [[_COMMUNITY_assistant-data.ts|assistant-data.ts]]
- [[_COMMUNITY_reports.ts|reports.ts]]
- [[_COMMUNITY_dues.ts|dues.ts]]

## God Nodes (most connected - your core abstractions)
1. `rs()` - 48 edges
2. `round2()` - 32 edges
3. `makeTools()` - 31 edges
4. `useConfirm()` - 31 edges
5. `DB` - 30 edges
6. `todayLK()` - 29 edges
7. `AssistantData` - 27 edges
8. `useApiMutation()` - 26 edges
9. `transactionRoutes()` - 24 edges
10. `downloadExcel()` - 24 edges

## Surprising Connections (you probably didn't know these)
- `invoiceMoney()` --calls--> `text()`  [INFERRED]
  backend/src/db/schema.ts → shared/src/schemas.ts
- `productsWithStock()` --indirect_call--> `freeQty()`  [INFERRED]
  backend/src/routes/catalog.ts → frontend/src/pages/Stock.tsx
- `catalogRoutes()` --indirect_call--> `page()`  [INFERRED]
  backend/src/routes/catalog.ts → frontend/src/App.tsx
- `scanRoutes()` --indirect_call--> `parties()`  [INFERRED]
  backend/src/routes/scan.ts → frontend/src/App.tsx
- `Settings()` --calls--> `label()`  [INFERRED]
  frontend/src/pages/Settings.tsx → backend/src/services/assistant.ts

## Import Cycles
- None detected.

## Communities (41 total, 1 thin omitted)

### Community 0 - "assistant-data.ts"
Cohesion: 0.06
Nodes (31): ADJ_REASONS, AdjustmentRequest, AssistantData, Breakdown, BreakdownRow, clamp(), FoundInvoice, InvoiceListRow (+23 more)

### Community 1 - "types.ts"
Cohesion: 0.06
Nodes (51): DocParty, InvoiceDocument(), NewRow, PurchaseRow, SaleRow, amountInWords(), below1000(), CalcLine (+43 more)

### Community 2 - "scan.ts"
Cohesion: 0.07
Nodes (53): SEED_PURCHASES, catalog, codeOf, fixture(), read(), truthOf(), defaultScanModel(), bigrams() (+45 more)

### Community 3 - "Purchases.tsx"
Cohesion: 0.16
Nodes (22): blankLine(), DraftLine, emptyDraft(), prepareFile(), ScanReview(), ScanState, scanToDraft(), ScanUpload() (+14 more)

### Community 4 - "Products.tsx"
Cohesion: 0.11
Nodes (31): ConfirmFn, ConfirmOptions, Ctx, alignCls(), Column, DataTable(), DataTableProps, hideCls() (+23 more)

### Community 5 - "invoices.ts"
Cohesion: 0.19
Nodes (29): Tx, badRequest(), conflict(), notFound(), applyRequest(), rejectRequest(), checkProducts(), deletePurchase() (+21 more)

### Community 6 - "catalog.ts"
Cohesion: 0.07
Nodes (26): newKey(), daysBetween(), AdjustmentInput, adjustmentSchema, BulkPriceInput, CustomerInput, CustomerTypeInput, date (+18 more)

### Community 7 - "devDependencies"
Cohesion: 0.05
Nodes (40): dependencies, @anthropic-ai/sdk, compression, cors, drizzle-orm, @electric-sql/pglite, express, helmet (+32 more)

### Community 8 - "index.ts"
Cohesion: 0.15
Nodes (19): ids, today, uploadDir, Database, migrationsDir(), openDatabase(), runMigrations(), products (+11 more)

### Community 9 - "dependencies"
Cohesion: 0.06
Nodes (34): dependencies, lucide-react, pdfjs-dist, @pjd/shared, react, react-dom, react-router-dom, sonner (+26 more)

### Community 10 - "InvoiceImages.tsx"
Cohesion: 0.11
Nodes (32): InvoiceImages(), Lightbox(), PhotoImg(), attachScanPhoto(), getImageToken(), errorMessage(), base(), imageUrl() (+24 more)

### Community 11 - "Layout.tsx"
Cohesion: 0.05
Nodes (37): parties(), products(), purchases(), router, sales(), AuthGate(), Login(), LogoutCtx (+29 more)

### Community 12 - "Reports.tsx"
Cohesion: 0.10
Nodes (25): api, authHeaders(), getToken(), Params, request(), cell(), downloadExcel(), FORMATS (+17 more)

### Community 13 - "assistant.test.ts"
Cohesion: 0.16
Nodes (22): customerTypes, payments, anthropicError(), AppError, errorHandler(), friendlyIssue(), pgCode(), assistantRoutes() (+14 more)

### Community 14 - "images.ts"
Cohesion: 0.17
Nodes (29): createApp(), initAuth(), DB, idParam(), parse(), saved, paginate(), col() (+21 more)

### Community 15 - "Pricing.tsx"
Cohesion: 0.13
Nodes (22): useConfirm(), ClientTable(), Tabs(), useApiMutation(), useCustomerTypes(), CustomerForm(), SupplierForm(), Edit (+14 more)

### Community 16 - "schema.ts"
Cohesion: 0.11
Nodes (24): assistantRequests, cost(), created(), customers, invoiceImages, invoiceMoney(), lineCols(), money() (+16 more)

### Community 17 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+11 more)

### Community 18 - "scripts"
Cohesion: 0.11
Nodes (18): devDependencies, concurrently, engines, node, name, private, scripts, build (+10 more)

### Community 19 - "rs"
Cohesion: 0.16
Nodes (27): Totals(), NumberInput(), useListState(), usePaged(), Bars(), InvoicePhotos(), CustomerDetail(), statementCard() (+19 more)

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
Cohesion: 0.13
Nodes (24): Executor, priceRules, promotions, sizeRank(), SortVal, batchValue(), catalogRoutes(), createProduct() (+16 more)

### Community 25 - "Dashboard.tsx"
Cohesion: 0.21
Nodes (8): change(), Dashboard(), DashboardData, dayLabel(), greeting(), SalesChart(), short(), qtyFmt()

### Community 26 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, lib, module, moduleResolution, noEmit, skipLibCheck, strict (+4 more)

### Community 27 - "vercel.json"
Cohesion: 0.15
Nodes (12): includeFiles, maxDuration, buildCommand, framework, functions, api/index.mjs, headers, installCommand (+4 more)

### Community 28 - "auth.ts"
Cohesion: 0.15
Nodes (21): authEnabled(), authRoutes(), hmac(), issue(), issueImageToken(), issueToken(), loginLimiter, password() (+13 more)

### Community 29 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 30 - "copy-ocr.mjs"
Cohesion: 0.40
Nodes (3): files, out, require

### Community 37 - "InvoiceEditor.tsx"
Cohesion: 0.15
Nodes (17): Combobox(), Draft, InvoiceEditor(), priceLine(), Badge(), Field(), CustomerOption, ProductOption (+9 more)

### Community 38 - "assistant-data.ts"
Cohesion: 0.17
Nodes (16): batuThel(), customerFilters, customersWithBalance(), partySorters, statement(), suppliersWithBalance(), assistantData(), compute() (+8 more)

### Community 39 - "reports.ts"
Cohesion: 0.27
Nodes (14): insightRoutes(), publicSettings(), range, today(), Profit, salesByCustomer(), salesByProduct(), salesByType() (+6 more)

### Community 40 - "dues.ts"
Cohesion: 0.29
Nodes (8): EMPTY, InvRow, addDays(), allocateDues(), DueInvoice, DueResult, InvoiceStatus, PartyBalance

## Knowledge Gaps
- **307 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+302 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `rs()` connect `rs` to `types.ts`, `scan.ts`, `Purchases.tsx`, `Products.tsx`, `InvoiceEditor.tsx`, `invoices.ts`, `assistant-data.ts`, `reports.ts`, `Reports.tsx`, `Pricing.tsx`, `Dashboard.tsx`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `todayLK()` connect `reports.ts` to `types.ts`, `Purchases.tsx`, `invoices.ts`, `assistant-data.ts`, `InvoiceEditor.tsx`, `index.ts`, `dues.ts`, `Reports.tsx`, `assistant.test.ts`, `Pricing.tsx`, `rs`, `Assistant.tsx`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `round2()` connect `Assistant.tsx` to `types.ts`, `scan.ts`, `invoices.ts`, `assistant-data.ts`, `reports.ts`, `dues.ts`, `catalog.ts`, `images.ts`, `schema.ts`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _307 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `assistant-data.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.056866303690260134 - nodes in this community are weakly interconnected._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05639097744360902 - nodes in this community are weakly interconnected._
- **Should `scan.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06594071385359952 - nodes in this community are weakly interconnected._