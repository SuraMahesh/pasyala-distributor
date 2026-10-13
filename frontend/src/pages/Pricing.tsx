import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Gift, Pencil, Plus, Printer, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { rs, todayLK, type CustomerType, type PriceQuote, type PriceRule, type Promotion } from '@pjd/shared'
import Combobox from '../components/Combobox'
import { useConfirm } from '../components/Confirm'
import { ClientTable, type Column } from '../components/DataTable'
import PrintPreview from '../components/PrintPreview'
import { Badge, Field, Filters, Modal, NumberInput, PageHeader, SearchBox, Spinner, Tabs } from '../components/ui'
import { api } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { useApiMutation, useCustomerTypes, useProductOptions, useSettings } from '../lib/hooks'

type Tab = 'types' | 'grid' | 'promotions'

export default function Pricing() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'types'
  return (
    <div>
      <PageHeader
        title="Prices & discounts"
        subtitle="How each product is priced for shops, medical centers, pharmacies and walk-in customers"
      />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        tabs={[
          { key: 'types', label: 'Customer types' },
          { key: 'grid', label: 'Product prices' },
          { key: 'promotions', label: 'Free issues' },
        ]}
      />
      <HowItWorks />
      {tab === 'types' && <TypesTab />}
      {tab === 'grid' && <GridTab />}
      {tab === 'promotions' && <PromotionsTab />}
    </div>
  )
}

function HowItWorks() {
  return (
    <details className="card mb-4 p-3 text-sm text-stone-600">
      <summary className="cursor-pointer font-medium text-stone-800">How is the selling price chosen?</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li><b>Product price</b> for that customer type (a fixed price or a discount %) — set on the Product prices tab.</li>
        <li>Otherwise the <b>customer's own discount %</b> — set on the customer.</li>
        <li>Otherwise the <b>customer type discount %</b> (e.g. Shop 10%, Medical Center 15%) on the product's base selling price.</li>
        <li><b>Free issues</b> (e.g. buy 12 get 1) are added automatically when the qty qualifies. You can always change the price, discount or free qty on the invoice line.</li>
      </ol>
    </details>
  )
}

// ---------------------------------------------------------------- customer types

function TypesTab() {
  const { data: types = [], isLoading } = useCustomerTypes()
  const [editing, setEditing] = useState<CustomerType | null>(null)
  const columns: Column<CustomerType>[] = [
    { key: 'name', header: 'Type', render: (t) => <span className="font-medium">{t.name}</span> },
    { key: 'code', header: 'Code', render: (t) => <span className="font-mono text-xs text-stone-500">{t.code}</span> },
    { key: 'disc', header: 'Default discount', align: 'right', render: (t) => (t.defaultDiscPct ? `${t.defaultDiscPct}%` : <span className="text-stone-400">none</span>) },
    { key: 'credit', header: 'Credit days', align: 'right', render: (t) => t.creditDays },
    { key: 'count', header: 'Customers', align: 'right', render: (t) => t.customerCount ?? 0 },
    { key: 'edit', header: '', align: 'right', mobile: false, render: (t) => <button className="btn-ghost" onClick={() => setEditing(t)} aria-label="Edit"><Pencil size={15} /></button> },
  ]
  if (isLoading) return <Spinner />
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button className="btn-primary" onClick={() => setEditing({ id: 0, code: '', name: '', defaultDiscPct: 0, creditDays: 30, sort: types.length + 1 })}><Plus size={16} /> Add customer type</button>
      </div>
      <ClientTable rows={types} columns={columns} rowKey={(t) => t.id} mobileCard={(t) => (
        <div className="flex items-center justify-between gap-3" onClick={() => setEditing(t)}>
          <div><p className="font-medium">{t.name}</p><p className="text-xs text-stone-500">{t.customerCount} customers · {t.creditDays} credit days</p></div>
          <Badge tone={t.defaultDiscPct ? 'green' : 'gray'}>{t.defaultDiscPct}% off</Badge>
        </div>
      )} />
      {editing && <TypeForm type={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function TypeForm({ type, onClose }: { type: CustomerType; onClose: () => void }) {
  const isNew = !type.id
  const [t, setT] = useState(type)
  const confirm = useConfirm()
  const save = useApiMutation((body: CustomerType) => (isNew ? api.post('/customer-types', body) : api.put(`/customer-types/${type.id}`, body)), { success: 'Customer type saved', onSuccess: onClose })
  const del = useApiMutation(() => api.del(`/customer-types/${type.id}`), { success: 'Customer type deleted', onSuccess: onClose })
  const submit = async () => {
    if (!t.name.trim()) return
    if (!isNew && t.defaultDiscPct !== type.defaultDiscPct && (type.customerCount ?? 0) > 0) {
      const ok = await confirm({ title: 'Change discount for all these customers?', message: `${type.customerCount} customer(s) of type "${type.name}" will get ${t.defaultDiscPct}% on new invoices (unless they have their own discount or a product price). Existing invoices do not change.`, tone: 'warning', confirmText: 'Save' })
      if (!ok) return
    }
    save.mutate({ ...t, code: t.code.trim() || t.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20) })
  }
  return (
    <Modal open title={isNew ? 'Add customer type' : `Edit ${type.name}`} onClose={onClose} footer={
      <>
        {!isNew && <button className="btn-danger sm:mr-auto" onClick={async () => (await confirm({ title: `Delete "${type.name}"?`, message: 'Only possible when no customer uses it. Product prices and free issues for this type are removed too.', tone: 'danger', confirmText: 'Delete' })) && del.mutate(undefined)}><Trash2 size={15} /> Delete</button>}
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit} disabled={save.isPending}>Save</button>
      </>
    }>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name *" className="sm:col-span-2"><input className="input" autoFocus value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="e.g. Medical Center / Clinic" /></Field>
        <Field label="Code"><input className="input uppercase" value={t.code} onChange={(e) => setT({ ...t, code: e.target.value })} /></Field>
        <Field label="Sort order"><NumberInput step={1} value={t.sort} onChange={(v) => setT({ ...t, sort: Math.round(v ?? 0) })} /></Field>
        <Field label="Default discount %" hint="Off the base selling price"><NumberInput min={0} max={100} value={t.defaultDiscPct} onChange={(v) => setT({ ...t, defaultDiscPct: v ?? 0 })} /></Field>
        <Field label="Credit days" hint="Days before an unpaid invoice is overdue"><NumberInput min={0} max={365} step={1} value={t.creditDays} onChange={(v) => setT({ ...t, creditDays: Math.round(v ?? 0) })} /></Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- price grid

interface GridRow {
  productId: number
  code: string
  name: string
  size: string
  category: string
  sellPrice: number
  onHand: number
  rule: PriceRule | null
  quote: PriceQuote
}
type Edit = { mode: 'none' | 'price' | 'disc'; value: number | null }

function GridTab() {
  const { data: types = [] } = useCustomerTypes()
  const [typeId, setTypeId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [edits, setEdits] = useState<Map<number, Edit>>(new Map())
  const [printing, setPrinting] = useState(false)
  const confirm = useConfirm()
  useEffect(() => {
    if (!typeId && types.length) setTypeId(types[0].id)
  }, [types, typeId])
  const type = types.find((t) => t.id === typeId)
  const q = useQuery({ queryKey: ['price-list', typeId], queryFn: () => api.get<{ items: GridRow[] }>('/price-list', { typeId: typeId!, pageSize: 500 }), enabled: !!typeId })
  const save = useApiMutation((rules: unknown) => api.put('/price-rules', { rules }), { success: (_r, v) => `${(v as unknown[]).length} product prices saved`, onSuccess: () => setEdits(new Map()) })

  const rows = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
    return (q.data?.items ?? []).filter((r) => words.every((w) => `${r.code} ${r.size} ${r.name}`.toLowerCase().includes(w)))
  }, [q.data, search])

  const editOf = (r: GridRow): Edit => edits.get(r.productId) ?? (r.rule?.price != null ? { mode: 'price', value: r.rule.price } : r.rule?.discPct != null ? { mode: 'disc', value: r.rule.discPct } : { mode: 'none', value: null })
  const setEdit = (r: GridRow, e: Edit) => setEdits((m) => new Map(m).set(r.productId, e))
  const preview = (r: GridRow) => {
    const e = editOf(r)
    if (e.mode === 'price' && e.value != null) return { net: e.value, label: 'special price' }
    if (e.mode === 'disc' && e.value != null) return { net: r.sellPrice * (1 - e.value / 100), label: `${e.value}% product discount` }
    if (edits.has(r.productId)) return { net: r.sellPrice * (1 - (type?.defaultDiscPct ?? 0) / 100), label: `${type?.defaultDiscPct ?? 0}% type discount` }
    return { net: r.quote.netUnitPrice, label: r.quote.sourceLabel }
  }

  const changed = [...edits.entries()].filter(([pid, e]) => {
    const r = q.data?.items.find((x) => x.productId === pid)
    const orig = r?.rule?.price != null ? `price:${r.rule.price}` : r?.rule?.discPct != null ? `disc:${r.rule.discPct}` : 'none:'
    return `${e.mode}:${e.mode === 'none' ? '' : e.value}` !== orig
  })

  const submit = async () => {
    const rules = changed.map(([productId, e]) => ({ productId, customerTypeId: typeId, price: e.mode === 'price' ? e.value : null, discPct: e.mode === 'disc' ? e.value : null }))
    const bad = rules.find((r) => (r.price != null && r.price < 0) || (r.discPct != null && (r.discPct < 0 || r.discPct > 100)))
    if (bad) return
    if (await confirm({ title: `Save ${rules.length} price change(s) for ${type?.name}?`, message: 'New invoices for this customer type will use these prices. Existing invoices do not change.', confirmText: 'Save prices' })) save.mutate(rules)
  }

  const columns: Column<GridRow>[] = [
    { key: 'item', header: 'Item', sortKey: 'name', sortValue: (r) => `${r.name} ${r.size}`, render: (r) => <span><span className="text-stone-500">{r.size}</span> <span className="font-medium">{r.name}</span><span className="ml-1.5 font-mono text-xs text-stone-400">{r.code}</span></span> },
    { key: 'base', header: 'Base price', align: 'right', sortKey: 'base', sortValue: (r) => r.sellPrice, render: (r) => rs(r.sellPrice) },
    {
      key: 'rule', header: `Special for ${type?.name ?? ''}`, mobile: false,
      render: (r) => <RuleEditor value={editOf(r)} onChange={(e) => setEdit(r, e)} dirty={edits.has(r.productId)} />,
    },
    {
      key: 'net', header: 'Net price', align: 'right', sortKey: 'net', sortValue: (r) => preview(r).net,
      render: (r) => { const p = preview(r); return <span><span className="font-semibold">{rs(p.net)}</span><span className="block text-[11px] text-stone-400">{p.label}</span></span> },
    },
    { key: 'promo', header: 'Free issue', hideBelow: 'xl', render: (r) => (r.quote.promotion ? <Badge tone="green">{r.quote.promotion.buyQty}+{r.quote.promotion.freeQty}</Badge> : '') },
  ]

  return (
    <>
      <Filters>
        <select className="input" value={typeId ?? ''} onChange={async (e) => {
          if (changed.length && !(await confirm({ title: 'Discard unsaved price changes?', tone: 'warning', confirmText: 'Discard' }))) return
          setEdits(new Map())
          setTypeId(Number(e.target.value))
        }}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.defaultDiscPct}% default)</option>)}
        </select>
        <SearchBox value={search} onChange={setSearch} placeholder="Find product…" />
        <button className="btn-secondary" onClick={() => setPrinting(true)} disabled={!q.data}><Printer size={16} /> Print price list</button>
        <button className="btn-secondary" disabled={!q.data} onClick={() => type && q.data && downloadExcel(`price-list-${type.name.replace(/\W+/g, '-')}`, [{
          name: type.name,
          columns: [{ header: 'Code' }, { header: 'Size' }, { header: 'Item' }, { header: 'Base price (MRP)', type: 'money' }, { header: 'Discount %', type: 'pct' }, { header: 'Net price', type: 'money' }, { header: 'Price from' }, { header: 'Free issue' }],
          rows: q.data.items.map((r) => [r.code, r.size, r.name, r.quote.unitPrice, r.quote.discPct || null, r.quote.netUnitPrice, r.quote.sourceLabel, r.quote.promotion ? `Buy ${r.quote.promotion.buyQty} get ${r.quote.promotion.freeQty}` : '']),
        }])}><FileSpreadsheet size={16} /> Excel</button>
      </Filters>
      {changed.length > 0 && (
        <div className="sticky top-14 z-20 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm lg:top-2">
          <span><b>{changed.length}</b> unsaved price change(s) for {type?.name}</span>
          <span className="flex gap-2">
            <button className="btn-secondary" onClick={() => setEdits(new Map())}><RotateCcw size={15} /> Undo</button>
            <button className="btn-primary" onClick={submit} disabled={save.isPending}><Save size={15} /> Save prices</button>
          </span>
        </div>
      )}
      {q.isLoading ? <Spinner /> : (
        <ClientTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.productId}
          initialPageSize={50}
          pageSizes={[25, 50, 100, 200]}
          mobileCard={(r) => {
            const p = preview(r)
            return (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate font-medium"><span className="text-stone-500">{r.size}</span> {r.name}</p><p className="text-xs text-stone-500">Base {rs(r.sellPrice)}{r.quote.promotion ? ` · ${r.quote.promotion.buyQty}+${r.quote.promotion.freeQty} free` : ''}</p></div>
                  <div className="text-right"><p className="font-semibold">{rs(p.net)}</p><p className="text-[11px] text-stone-400">{p.label}</p></div>
                </div>
                <RuleEditor value={editOf(r)} onChange={(e) => setEdit(r, e)} dirty={edits.has(r.productId)} />
              </div>
            )
          }}
        />
      )}
      {type && q.data && (
        <PrintPreview open={printing} onClose={() => setPrinting(false)} title={`Price list - ${type.name}`}>
          <PriceListDoc type={type} rows={q.data.items} />
        </PrintPreview>
      )}
    </>
  )
}

function RuleEditor({ value, onChange, dirty }: { value: Edit; onChange: (e: Edit) => void; dirty: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${dirty ? 'rounded-md bg-amber-50 p-1 ring-1 ring-amber-200' : ''}`}>
      <select className="input w-auto py-1.5 text-xs" value={value.mode} onChange={(e) => onChange({ mode: e.target.value as Edit['mode'], value: e.target.value === 'none' ? null : value.value })} aria-label="Special price type">
        <option value="none">Type default</option>
        <option value="disc">Discount %</option>
        <option value="price">Fixed price</option>
      </select>
      {value.mode !== 'none' && (
        <NumberInput className="w-24 py-1.5" min={0} max={value.mode === 'disc' ? 100 : undefined} step="0.01" value={value.value} onChange={(v) => onChange({ ...value, value: v })} aria-label="Special value" />
      )}
    </div>
  )
}

function PriceListDoc({ type, rows }: { type: CustomerType; rows: GridRow[] }) {
  const { data: settings } = useSettings()
  return (
    <div className="print-area card mx-auto max-w-4xl bg-white p-6 text-[12px]">
      <div className="text-center">
        <h2 className="text-lg font-bold">{settings?.name}</h2>
        <p className="text-stone-600">{[settings?.address, settings?.phone].filter(Boolean).join(' · ')}</p>
        <p className="mt-3 text-base font-bold tracking-widest">PRICE LIST — {type.name.toUpperCase()}</p>
        <p className="text-stone-500">Valid from {todayLK()}</p>
      </div>
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y-2 border-stone-800 text-left text-[11px] uppercase">
            <th className="py-1">Code</th><th className="py-1">Item</th><th className="py-1 text-right">MRP</th><th className="py-1 text-right">Disc</th><th className="py-1 text-right">Your price</th><th className="py-1 text-right">Free issue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.productId} className="border-b border-stone-100">
              <td className="py-0.5 font-mono text-[11px]">{r.code}</td>
              <td className="py-0.5">{r.size} {r.name}</td>
              <td className="py-0.5 text-right tabular-nums">{rs(r.quote.unitPrice)}</td>
              <td className="py-0.5 text-right tabular-nums">{r.quote.discPct ? `${r.quote.discPct}%` : ''}</td>
              <td className="py-0.5 text-right font-semibold tabular-nums">{rs(r.quote.netUnitPrice)}</td>
              <td className="py-0.5 text-right">{r.quote.promotion ? `${r.quote.promotion.buyQty} + ${r.quote.promotion.freeQty}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- promotions

type PromoRow = Promotion & { productLabel: string; productCode: string; typeName: string | null }

function PromotionsTab() {
  const q = useQuery({ queryKey: ['promotions'], queryFn: () => api.get<PromoRow[]>('/promotions') })
  const [editing, setEditing] = useState<Promotion | null>(null)
  const today = todayLK()
  const state = (p: Promotion) => (!p.active ? ['Off', 'gray'] : p.endDate && p.endDate < today ? ['Ended', 'gray'] : p.startDate && p.startDate > today ? ['Starts ' + p.startDate, 'blue'] : ['Running', 'green']) as [string, 'gray' | 'blue' | 'green']
  const columns: Column<PromoRow>[] = [
    { key: 'item', header: 'Item', sortKey: 'item', sortValue: (p) => p.productLabel, render: (p) => <span className="font-medium">{p.productLabel}</span> },
    { key: 'deal', header: 'Deal', render: (p) => <span className="inline-flex items-center gap-1"><Gift size={14} className="text-brand-600" /> Buy {p.buyQty} get {p.freeQty} free</span> },
    { key: 'for', header: 'For', render: (p) => p.typeName ?? 'All customer types' },
    { key: 'dates', header: 'Dates', hideBelow: 'lg', render: (p) => <span className="text-stone-500">{p.startDate ?? '…'} → {p.endDate ?? '…'}</span> },
    { key: 'state', header: 'Status', render: (p) => { const [l, t] = state(p); return <Badge tone={t}>{l}</Badge> } },
    { key: 'edit', header: '', align: 'right', mobile: false, render: (p) => <button className="btn-ghost" onClick={() => setEditing(p)}><Pencil size={15} /></button> },
  ]
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button className="btn-primary" onClick={() => setEditing({ id: 0, name: '', productId: 0, customerTypeId: null, buyQty: 12, freeQty: 1, startDate: null, endDate: null, active: true })}><Plus size={16} /> Add free issue</button>
      </div>
      {q.isLoading ? <Spinner /> : (
        <ClientTable rows={q.data ?? []} columns={columns} rowKey={(p) => p.id} empty="No free-issue deals yet. Example: buy 12 bottles, get 1 free for shops." mobileCard={(p) => (
          <div className="flex items-center justify-between gap-2" onClick={() => setEditing(p)}>
            <div className="min-w-0"><p className="truncate font-medium">{p.productLabel}</p><p className="text-xs text-stone-500">Buy {p.buyQty} get {p.freeQty} · {p.typeName ?? 'all types'}</p></div>
            <Badge tone={state(p)[1]}>{state(p)[0]}</Badge>
          </div>
        )} />
      )}
      {editing && <PromoForm promo={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function PromoForm({ promo, onClose }: { promo: Promotion; onClose: () => void }) {
  const isNew = !promo.id
  const [p, setP] = useState(promo)
  const [err, setErr] = useState('')
  const { data: products = [] } = useProductOptions()
  const { data: types = [] } = useCustomerTypes()
  const confirm = useConfirm()
  const save = useApiMutation((body: Promotion) => (isNew ? api.post('/promotions', body) : api.put(`/promotions/${promo.id}`, body)), { success: 'Free issue saved', onSuccess: onClose, silentError: true })
  const del = useApiMutation(() => api.del(`/promotions/${promo.id}`), { success: 'Free issue deleted', onSuccess: onClose })
  const submit = () => {
    if (!p.productId) return setErr('Choose an item')
    if (p.startDate && p.endDate && p.endDate < p.startDate) return setErr('End date is before start date')
    save.mutate(p, { onError: (e) => setErr(e.message) })
  }
  return (
    <Modal open title={isNew ? 'Add free issue' : 'Edit free issue'} onClose={onClose} footer={
      <>
        {!isNew && <button className="btn-danger sm:mr-auto" onClick={async () => (await confirm({ title: 'Delete this free issue?', tone: 'danger', confirmText: 'Delete' })) && del.mutate(undefined)}><Trash2 size={15} /> Delete</button>}
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={submit}>Save</button>
      </>
    }>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item *" className="sm:col-span-2">
          <Combobox items={products} value={p.productId || null} onChange={(id) => setP({ ...p, productId: id })} getId={(x) => x.id} getLabel={(x) => `${x.size} ${x.name}`} getSearch={(x) => `${x.code} ${x.size} ${x.name}`} />
        </Field>
        <Field label="Buy qty"><NumberInput min={1} step={1} value={p.buyQty} onChange={(v) => setP({ ...p, buyQty: Math.max(1, Math.round(v ?? 1)) })} /></Field>
        <Field label="Get free"><NumberInput min={1} step={1} value={p.freeQty} onChange={(v) => setP({ ...p, freeQty: Math.max(1, Math.round(v ?? 1)) })} /></Field>
        <Field label="For customer type" className="sm:col-span-2">
          <select className="input" value={p.customerTypeId ?? ''} onChange={(e) => setP({ ...p, customerTypeId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">All customer types</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="From (optional)"><input type="date" className="input" value={p.startDate ?? ''} onChange={(e) => setP({ ...p, startDate: e.target.value || null })} /></Field>
        <Field label="To (optional)"><input type="date" className="input" value={p.endDate ?? ''} onChange={(e) => setP({ ...p, endDate: e.target.value || null })} /></Field>
        <Field label="Name / note" className="sm:col-span-2"><input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="e.g. Avurudu offer" /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> Active</label>
      </div>
      <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">Example: selling 36 → {Math.floor(36 / (p.buyQty || 1)) * p.freeQty} free.</p>
      {err && <p className="mt-3 text-sm font-medium text-red-600">{err}</p>}
    </Modal>
  )
}
