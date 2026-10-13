import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Pencil, Percent, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CATEGORIES, rs, suggestProductCode, type Movement, type Paged, type PriceQuote, type Product, type ProductWithStock, type Promotion, type CustomerType } from '@pjd/shared'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column } from '../components/DataTable'
import { Badge, ErrorBox, Field, Filters, Modal, NumberInput, PageHeader, SearchBox, Spinner, Stat, StockBadge } from '../components/ui'
import { api, fetchAll } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { useApiMutation, useListState, usePaged } from '../lib/hooks'

const SIZES = ['4.5L', '1L', '750ML', '375ML', '180ML', '100ML', '30ML', '1kg', '100g', '50g', '30g']

export function useProductMeta() {
  return useQuery({ queryKey: ['products', 'meta'], queryFn: () => api.get<{ categories: string[]; sizes: string[] }>('/products/meta') })
}

export default function Products() {
  const [s, set] = useListState({ category: '', size: '', status: '', stock: '', sort: 'name', dir: 'asc' as const })
  const q = usePaged<ProductWithStock>('products', '/products', s)
  const { data: meta } = useProductMeta()
  const [editing, setEditing] = useState<Product | null>(null)
  const [bulk, setBulk] = useState(false)

  const columns: Column<ProductWithStock>[] = [
    { key: 'item', header: 'Item', sortKey: 'name', render: (p) => <Link to={`/products/${p.id}`} className="font-medium hover:text-brand-700 hover:underline"><span className="text-stone-500">{p.size}</span> {p.name}{!p.active && <Badge>inactive</Badge>}</Link> },
    { key: 'code', header: 'Code', sortKey: 'code', render: (p) => <span className="font-mono text-xs text-stone-500">{p.code}</span> },
    { key: 'cat', header: 'Category', sortKey: 'category', hideBelow: 'xl', render: (p) => <span className="text-stone-500">{p.category}</span>, mobile: false },
    { key: 'list', header: 'Unit price', sortKey: 'listPrice', align: 'right', render: (p) => (p.listPrice === 0 ? <Badge tone="green">Free</Badge> : rs(p.listPrice)) },
    { key: 'disc', header: 'Disc %', sortKey: 'supplierDiscPct', align: 'right', hideBelow: 'lg', render: (p) => <span className="text-stone-500">{p.supplierDiscPct ? `${p.supplierDiscPct}%` : '—'}</span> },
    { key: 'sell', header: 'Sell price', sortKey: 'sellPrice', align: 'right', render: (p) => <span className="font-medium">{rs(p.sellPrice)}</span> },
    { key: 'stock', header: 'Stock', sortKey: 'onHand', align: 'right', render: (p) => <StockBadge onHand={p.onHand} reorderLevel={p.reorderLevel} /> },
    { key: 'amount', header: 'Stock amount', sortKey: 'stockValue', align: 'right', hideBelow: 'lg', render: (p) => <span className="tabular-nums">{rs(p.stockValue)}</span> },
    { key: 'edit', header: '', align: 'right', mobile: false, render: (p) => <button className="btn-ghost" onClick={() => setEditing(p)} aria-label="Edit"><Pencil size={15} /></button> },
  ]

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Unit price = supplier price before discount · unit price 0 = free item · stock amount is after discount"
        actions={
          <>
            <button className="btn-secondary" onClick={async () => {
              const all = await fetchAll<ProductWithStock>('/products', { ...s, page: undefined, pageSize: undefined })
              await downloadExcel('products', [{
                name: 'Products',
                columns: [{ header: 'Code' }, { header: 'Size' }, { header: 'Name' }, { header: 'Category' }, { header: 'Unit price', type: 'money' }, { header: 'Discount %', type: 'pct' }, { header: 'Selling price', type: 'money' }, { header: 'On hand', type: 'int' }, { header: 'Free qty', type: 'int' }, { header: 'Stock amount (after discount)', type: 'money' }, { header: 'Reorder level', type: 'int' }, { header: 'Active' }],
                rows: all.map((p) => [p.code, p.size, p.name, p.category, p.listPrice, p.supplierDiscPct, p.sellPrice, p.onHand, p.freeOnHand, p.stockValue, p.reorderLevel, p.active]),
              }])
            }}><FileSpreadsheet size={16} /> Excel</button>
            <button className="btn-secondary" onClick={() => setBulk(true)}><Percent size={16} /> Bulk price change</button>
            <button className="btn-primary" onClick={() => setEditing(newProduct())}><Plus size={16} /> Add product</button>
          </>
        }
      />
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Code, name, size…" />
        <select className="input" value={s.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="input" value={s.size} onChange={(e) => set({ size: e.target.value })}>
          <option value="">All sizes</option>
          {meta?.sizes.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select className="input" value={s.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Active & inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
      </Filters>
      <DataTable
        rows={q.data?.items ?? []}
        columns={columns}
        rowKey={(p) => p.id}
        loading={q.isFetching}
        error={q.error}
        page={q.data?.page ?? 1}
        pageSize={s.pageSize}
        total={q.data?.total ?? 0}
        onPage={(p) => set({ page: p }, false)}
        onPageSize={(n) => set({ pageSize: n })}
        sort={s.sort}
        dir={s.dir}
        onSort={(k, d) => set({ sort: k, dir: d })}
        rowLink={(p) => `/products/${p.id}`}
        rowClassName={(p) => (p.active ? '' : 'opacity-60')}
        empty="No products match."
        mobileCard={(p) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium"><span className="text-stone-500">{p.size}</span> {p.name}</p>
              <p className="text-xs text-stone-500"><span className="font-mono">{p.code}</span> · unit {p.listPrice === 0 ? 'Free' : rs(p.listPrice)} · stock Rs {rs(p.stockValue)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-semibold tabular-nums">{rs(p.sellPrice)}</p>
              <StockBadge onHand={p.onHand} reorderLevel={p.reorderLevel} />
            </div>
          </div>
        )}
      />
      {editing && <ProductForm product={editing} onClose={() => setEditing(null)} />}
      {bulk && <BulkPrice filters={s} total={q.data?.total ?? 0} onClose={() => setBulk(false)} />}
    </div>
  )
}

const newProduct = (): Product => ({ id: 0, code: '', name: '', size: '30ML', category: 'Thailaya (Oil)', listPrice: 0, supplierDiscPct: 22, sellPrice: 0, reorderLevel: 5, openingStock: 0, active: true })

export function ProductForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const isNew = !product.id
  const [p, setP] = useState(product)
  const [err, setErr] = useState('')
  const confirm = useConfirm()
  const save = useApiMutation((body: Product) => (isNew ? api.post<Product>('/products', body) : api.put<Product>(`/products/${product.id}`, body)), {
    success: (r) => (isNew ? `Product added — item code ${r.code}` : 'Product saved'),
    onSuccess: onClose,
    silentError: true,
  })
  const del = useApiMutation(() => api.del(`/products/${product.id}`), { success: 'Product deleted', onSuccess: onClose })

  const submit = async () => {
    if (!p.name.trim()) return setErr('Enter the product name.')
    if (!p.size.trim()) return setErr('Enter the size (e.g. 30ML, 750ML, 4.5L, 100g).')
    if (!isNew && p.sellPrice !== product.sellPrice && p.sellPrice < product.sellPrice * 0.5) {
      if (!(await confirm({ title: 'Big price drop', message: `Selling price changes from Rs ${rs(product.sellPrice)} to Rs ${rs(p.sellPrice)}. Continue?`, tone: 'warning', confirmText: 'Save' }))) return
    }
    // new products: the server creates the item code from name + size + category
    save.mutate(isNew ? { ...p, code: '' } : p, { onError: (e) => setErr(e.message) })
  }

  return (
    <Modal
      open
      title={isNew ? 'Add product' : `Edit ${product.size} ${product.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button
              className="btn-danger sm:mr-auto"
              onClick={async () => (await confirm({ title: 'Delete this product?', message: 'Only possible if it was never bought, sold or adjusted. Otherwise mark it inactive.', tone: 'danger', confirmText: 'Delete' })) && del.mutate(undefined)}
            >
              <Trash2 size={15} /> Delete
            </button>
          )}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={save.isPending}>Save</button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product name *" className="sm:col-span-2"><input className="input uppercase" autoFocus={isNew} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="MAHA NARAYANA" /></Field>
        <Field label="Size *">
          <input className="input" list="sizes" value={p.size} onChange={(e) => setP({ ...p, size: e.target.value })} />
          <datalist id="sizes">{SIZES.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label="Item code" hint={isNew ? 'Created automatically from name, size and category' : 'Item codes cannot be changed'}>
          <div className="input flex items-center bg-stone-50 font-mono text-stone-600 select-all">
            {isNew ? (p.name.trim() ? suggestProductCode(p.name, p.size, p.category) : '—') : p.code}
          </div>
        </Field>
        <Field label="Category">
          <select className="input" value={p.category} onChange={(e) => setP({ ...p, category: e.target.value as Product['category'] })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Supplier disc %"><NumberInput min={0} max={100} value={p.supplierDiscPct} onChange={(v) => setP({ ...p, supplierDiscPct: v ?? 0 })} /></Field>
        <Field label="Supplier list price (Rs)"><NumberInput min={0} step="0.01" value={p.listPrice} onChange={(v) => setP({ ...p, listPrice: v ?? 0 })} /></Field>
        <Field label="Base selling price (Rs)" hint="Customer type discounts & price rules apply on top of this"><NumberInput min={0} step="0.01" value={p.sellPrice} onChange={(v) => setP({ ...p, sellPrice: v ?? 0 })} /></Field>
        <Field label="Reorder level" hint="Alert when stock falls to this"><NumberInput min={0} step={1} value={p.reorderLevel} onChange={(v) => setP({ ...p, reorderLevel: Math.round(v ?? 0) })} /></Field>
        <Field label="Opening stock" hint="Stock you had before using the system"><NumberInput min={0} step={1} value={p.openingStock} onChange={(v) => setP({ ...p, openingStock: Math.round(v ?? 0) })} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-4 w-4" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> Active (can be put on new invoices)
        </label>
      </div>
      {err && <p className="mt-3 text-sm font-medium text-red-600">{err}</p>}
    </Modal>
  )
}

function BulkPrice({ filters, total, onClose }: { filters: Record<string, string | number>; total: number; onClose: () => void }) {
  const [mode, setMode] = useState<'percent' | 'fromList'>('percent')
  const [field, setField] = useState<'sellPrice' | 'listPrice'>('sellPrice')
  const [pct, setPct] = useState<number | null>(5)
  const [roundTo, setRoundTo] = useState<number | null>(5)
  const confirm = useConfirm()
  const apply = useApiMutation((body: unknown) => api.post<{ updated: number }>('/products/bulk-price', body), { success: (r) => `${r.updated} prices updated`, onSuccess: onClose })

  const run = async () => {
    const all = await api.get<Paged<{ id: number }>>('/products', { ...filters, page: 1, pageSize: 200 })
    const ids = all.items.map((p) => p.id)
    const what = mode === 'fromList' ? `Set selling price = list price ${pct! >= 0 ? '+' : ''}${pct}%` : `Change ${field === 'sellPrice' ? 'selling' : 'list'} price by ${pct}%`
    const ok = await confirm({ title: `Update ${ids.length} products?`, message: `${what}, rounded to Rs ${roundTo || 0.01}.`, details: 'Existing invoices keep their saved prices.', tone: 'warning', confirmText: 'Update prices' })
    if (ok) apply.mutate({ ids, mode, field, pct: pct ?? 0, roundTo: roundTo ?? 0 })
  }

  return (
    <Modal
      open
      title="Bulk price change"
      onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={run} disabled={apply.isPending || !total}>Apply to {total}</button></>}
    >
      <p className="mb-4 text-sm text-stone-600">Applies to the <b>{total}</b> products matching your current filters. Filter first to change only some (e.g. one size or category).</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What to do" className="sm:col-span-2">
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as 'percent' | 'fromList')}>
            <option value="percent">Increase / decrease a price by %</option>
            <option value="fromList">Set selling price from supplier list price</option>
          </select>
        </Field>
        {mode === 'percent' && (
          <Field label="Price">
            <select className="input" value={field} onChange={(e) => setField(e.target.value as 'sellPrice' | 'listPrice')}>
              <option value="sellPrice">Selling price</option>
              <option value="listPrice">Supplier list price</option>
            </select>
          </Field>
        )}
        <Field label={mode === 'fromList' ? 'List price + %' : 'Change %'} hint="Use a minus for a decrease"><NumberInput step="0.5" value={pct} onChange={setPct} /></Field>
        <Field label="Round to Rs" hint="0 = cents"><NumberInput min={0} value={roundTo} onChange={setRoundTo} /></Field>
      </div>
    </Modal>
  )
}

interface ProductDetailRes {
  product: ProductWithStock
  promotions: Promotion[]
  prices: { type: CustomerType; quote: PriceQuote }[]
}

export function ProductDetail() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['products', id], queryFn: () => api.get<ProductDetailRes>(`/products/${id}`) })
  const [mpage, setMpage] = useState(1)
  const [msize, setMsize] = useState(25)
  const moves = useQuery({ queryKey: ['products', id, 'movements', mpage, msize], queryFn: () => api.get<Paged<Movement>>(`/products/${id}/movements`, { page: mpage, pageSize: msize }) })
  const [edit, setEdit] = useState(false)
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <ErrorBox error={q.error ?? 'Not found'} />
  const { product: p, prices, promotions } = q.data

  const mcols: Column<Movement>[] = [
    { key: 'date', header: 'Date', render: (m) => <span className="text-stone-500">{m.date === '0000-00-00' ? '—' : m.date}</span> },
    { key: 'type', header: 'Type', render: (m) => <Badge tone={m.type === 'Purchase' ? 'green' : m.type === 'Sale' ? 'blue' : 'gray'}>{m.type}</Badge> },
    { key: 'ref', header: 'Reference', render: (m) => (m.refId && m.type !== 'Adjustment' ? <Link className="text-brand-700 hover:underline" to={`/${m.type === 'Sale' ? 'sales' : 'purchases'}/${m.refId}`}>{m.ref}</Link> : m.ref) },
    { key: 'party', header: 'Party / note', hideBelow: 'lg', render: (m) => <span className="text-stone-500">{m.party}</span> },
    { key: 'in', header: 'In', align: 'right', render: (m) => (m.qtyIn ? <span className="text-brand-700">+{m.qtyIn}</span> : '') },
    { key: 'out', header: 'Out', align: 'right', render: (m) => (m.qtyOut ? <span className="text-red-600">−{m.qtyOut}</span> : '') },
    { key: 'bal', header: 'Balance', align: 'right', render: (m) => <span className="font-medium">{m.balance}</span> },
  ]

  return (
    <div>
      <PageHeader
        back={{ to: '/products', label: 'Products' }}
        title={`${p.size} ${p.name}`}
        subtitle={`${p.code} · ${p.category}${p.active ? '' : ' · inactive'}`}
        actions={<button className="btn-secondary" onClick={() => setEdit(true)}><Pencil size={15} /> Edit</button>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="On hand" value={p.onHand} tone={p.onHand <= 0 ? 'bad' : p.onHand <= p.reorderLevel ? 'warn' : 'good'} hint={`Reorder at ${p.reorderLevel}`} />
        <Stat label="Unit price" value={p.listPrice === 0 ? 'Free' : `Rs ${rs(p.listPrice)}`} hint={`Selling price Rs ${rs(p.sellPrice)}`} />
        <Stat label="Amount" value={`Rs ${rs(p.grossValue)}`} hint={`${p.paidOnHand} charged${p.mixedDisc ? ` · ${p.batches.length} refills` : ` × ${rs(p.listPrice)}`}${p.freeOnHand ? ` · ${p.freeOnHand} free` : ''}`} />
        <Stat label="Stock amount" value={`Rs ${rs(p.stockValue)}`} hint={p.discountValue ? `After discount −Rs ${rs(p.discountValue)}` : 'No discount'} />
      </div>

      {p.batches.length > 0 && (
        <section className="card mt-5">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="font-semibold">Stock on hand by refill (GRN)</h2>
            <p className="text-xs text-stone-500">Each refill keeps its own unit price, line discount and bill discount. Sales use the oldest stock first.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">GRN</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Free</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">Unit price</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">Line disc</th>
                  <th className="hidden px-3 py-2 text-right sm:table-cell">Bill disc</th>
                  <th className="hidden px-3 py-2 text-right md:table-cell">Amount</th>
                  <th className="px-4 py-2 text-right">Stock amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 tabular-nums">
                {p.batches.map((b, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2">
                      {b.invoiceId ? <Link className="font-medium hover:underline" to={`/purchases/${b.invoiceId}`}>{b.invoiceNo}</Link> : <span className="text-stone-500">{b.invoiceNo}</span>}
                      {b.date && <span className="block text-xs text-stone-500">{b.date}</span>}
                      <span className="block text-xs text-stone-500 sm:hidden">{b.unitPrice ? rs(b.unitPrice) : 'Free'} · {b.lineDiscPct}%+{b.billDiscPct}%</span>
                    </td>
                    <td className="px-3 py-2 text-right">{b.qty}</td>
                    <td className="px-3 py-2 text-right text-brand-700">{b.freeQty || ''}</td>
                    <td className="hidden px-3 py-2 text-right sm:table-cell">{b.unitPrice ? rs(b.unitPrice) : 'Free'}</td>
                    <td className="hidden px-3 py-2 text-right sm:table-cell">{b.lineDiscPct}%</td>
                    <td className="hidden px-3 py-2 text-right sm:table-cell">{b.billDiscPct}%</td>
                    <td className="hidden px-3 py-2 text-right md:table-cell">{rs(b.amount)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{rs(b.stockAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-stone-200 font-semibold tabular-nums">
                <tr>
                  <td className="px-4 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{p.paidOnHand}</td>
                  <td className="px-3 py-2 text-right text-brand-700">{p.freeOnHand || ''}</td>
                  <td className="hidden sm:table-cell" />
                  <td className="hidden sm:table-cell" />
                  <td className="hidden sm:table-cell" />
                  <td className="hidden px-3 py-2 text-right md:table-cell">{rs(p.grossValue)}</td>
                  <td className="px-4 py-2 text-right">{rs(p.stockValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      <section className="card mt-5">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="font-semibold">Price by customer type</h2>
          <Link to="/pricing?tab=grid" className="text-sm text-brand-700 hover:underline">Edit prices</Link>
        </div>
        <ul className="divide-y divide-stone-100">
          {prices.map(({ type, quote }) => {
            return (
              <li key={type.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{type.name}</span>
                  <span className="ml-2 text-xs text-stone-500">{quote.sourceLabel}</span>
                </span>
                <span className="flex items-center gap-3 tabular-nums">
                  {quote.discPct > 0 && <span className="text-stone-500">{rs(quote.unitPrice)} − {quote.discPct}%</span>}
                  <span className="font-semibold">Rs {rs(quote.netUnitPrice)}</span>
                </span>
              </li>
            )
          })}
        </ul>
        {promotions.length > 0 && (
          <p className="border-t border-stone-100 px-4 py-2.5 text-sm text-stone-600">
            Free issue: {promotions.map((x) => `${x.name || `${x.buyQty}+${x.freeQty}`}${x.active ? '' : ' (off)'}`).join(', ')}
          </p>
        )}
      </section>

      <h2 className="mt-6 mb-2 font-semibold">Stock movements</h2>
      <DataTable
        rows={moves.data?.items ?? []}
        columns={mcols}
        rowKey={(m) => `${m.type}-${m.refId}-${m.date}-${m.balance}`}
        loading={moves.isFetching}
        error={moves.error}
        page={moves.data?.page ?? 1}
        pageSize={msize}
        total={moves.data?.total ?? 0}
        onPage={setMpage}
        onPageSize={(n) => { setMsize(n); setMpage(1) }}
        empty="No movements yet."
      />
      {edit && <ProductForm product={p} onClose={() => setEdit(false)} />}
    </div>
  )
}
