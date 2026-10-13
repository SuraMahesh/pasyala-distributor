import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, Pencil, Plus, Trash2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { rs, type Customer, type CustomerWithBalance, type StatementRow, type Supplier, type SupplierWithBalance } from '@pjd/shared'
import { useConfirm } from '../components/Confirm'
import { ClientTable, DataTable, type Column } from '../components/DataTable'
import { Badge, ErrorBox, Field, Filters, Modal, NumberInput, PageHeader, SearchBox, Spinner, Stat, StatusBadge, Tabs } from '../components/ui'
import { api, fetchAll } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { useApiMutation, useCustomerTypes, useListState, usePaged } from '../lib/hooks'
import { PaymentModal } from './Payments'

// ================================================================ customers

export function CustomerList() {
  const [s, set] = useListState({ typeId: '', area: '', status: '', active: 'active', sort: 'name', dir: 'asc' as const })
  const { data: types = [] } = useCustomerTypes()
  const { data: areas = [] } = useQuery({ queryKey: ['customers', 'areas'], queryFn: () => api.get<string[]>('/customers/areas') })
  const q = usePaged<CustomerWithBalance, { receivable: number; overdue: number; overLimit: number }>('customers', '/customers', { ...s, active: s.active === 'all' ? '' : s.active })
  const [editing, setEditing] = useState<Customer | null>(null)
  const [paying, setPaying] = useState<number | null>(null)

  const columns: Column<CustomerWithBalance>[] = [
    { key: 'name', header: 'Name', sortKey: 'name', render: (c) => <Link to={`/customers/${c.id}`} className="font-medium hover:text-brand-700 hover:underline">{c.name}{!c.active && <span className="ml-1"><Badge>inactive</Badge></span>}</Link> },
    { key: 'type', header: 'Type', sortKey: 'type', render: (c) => <Badge tone="blue">{c.typeName}</Badge> },
    { key: 'area', header: 'Area', sortKey: 'area', hideBelow: 'lg', render: (c) => <span className="text-stone-500">{c.area}</span> },
    { key: 'phone', header: 'Phone', hideBelow: 'xl', render: (c) => <span className="text-stone-500">{c.phone}</span>, mobile: false },
    { key: 'disc', header: 'Discount', align: 'right', hideBelow: 'xl', render: (c) => (c.discPct != null ? `${c.discPct}%` : <span className="text-stone-400">type</span>), mobile: false },
    { key: 'billed', header: 'Billed', sortKey: 'billed', align: 'right', hideBelow: 'lg', render: (c) => rs(c.billed) },
    {
      key: 'bal', header: 'Balance', sortKey: 'balance', align: 'right',
      render: (c) => c.balance > 0.004 ? <Badge tone={c.overdue > 0 || c.overLimit ? 'red' : 'amber'}>{rs(c.balance)}</Badge> : c.balance < -0.004 ? <Badge tone="green">credit {rs(-c.balance)}</Badge> : <span className="text-stone-300">0.00</span>,
    },
    { key: 'over', header: 'Overdue', sortKey: 'overdue', align: 'right', render: (c) => (c.overdue > 0 ? <span className="font-medium text-red-600">{rs(c.overdue)}</span> : '') },
    {
      key: 'act', header: '', align: 'right', mobile: false,
      render: (c) => (
        <span className="inline-flex whitespace-nowrap">
          <button className="btn-ghost" title="Receive payment" onClick={() => setPaying(c.id)}><Wallet size={15} /></button>
          <button className="btn-ghost" title="Edit" onClick={() => setEditing(c)}><Pencil size={15} /></button>
        </span>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Shops & customers"
        subtitle="Shops, medical centers, pharmacies and walk-in customers — each type gets its own prices"
        actions={
          <>
            <button className="btn-secondary" onClick={async () => {
              const all = await fetchAll<CustomerWithBalance>('/customers', { ...s, active: s.active === 'all' ? '' : s.active, page: undefined, pageSize: undefined })
              await downloadExcel('customers', [{
                name: 'Customers',
                columns: [{ header: 'Code' }, { header: 'Name' }, { header: 'Type' }, { header: 'Area' }, { header: 'Phone' }, { header: 'Address' }, { header: 'Own discount %', type: 'pct' }, { header: 'Credit limit', type: 'money' }, { header: 'Credit days', type: 'int' }, { header: 'Invoices', type: 'int' }, { header: 'Billed', type: 'money' }, { header: 'Paid', type: 'money' }, { header: 'Balance', type: 'money' }, { header: 'Overdue', type: 'money' }, { header: 'Oldest due date' }, { header: 'Active' }],
                rows: all.map((c) => [c.code, c.name, c.typeName, c.area, c.phone, c.address, c.discPct, c.creditLimit, c.creditDays, c.invoices, c.billed, c.paid, c.balance, c.overdue, c.oldestDueDate, c.active]),
                totals: [10, 11, 12, 13],
              }])
            }}><FileSpreadsheet size={16} /> Excel</button>
            <button className="btn-primary" onClick={() => setEditing(blankCustomer(types[0]?.id ?? 0))}><Plus size={16} /> Add customer</button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="To collect" value={`Rs ${rs(q.data?.summary.receivable)}`} tone="warn" />
        <Stat label="Overdue" value={`Rs ${rs(q.data?.summary.overdue)}`} tone={q.data?.summary.overdue ? 'bad' : 'default'} to="/customers?status=overdue" />
        <Stat label="Over limit" value={q.data?.summary.overLimit ?? 0} tone={q.data?.summary.overLimit ? 'bad' : 'default'} to="/customers?status=overLimit" />
      </div>
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Name, area, phone…" />
        <select className="input" value={s.typeId} onChange={(e) => set({ typeId: e.target.value })}>
          <option value="">All types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.customerCount})</option>)}
        </select>
        <select className="input" value={s.area} onChange={(e) => set({ area: e.target.value })}>
          <option value="">All areas</option>
          {areas.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select className="input" value={s.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any balance</option>
          <option value="owing">Owes money</option>
          <option value="overdue">Overdue</option>
          <option value="overLimit">Over credit limit</option>
          <option value="credit">Has credit</option>
        </select>
        <select className="input" value={s.active} onChange={(e) => set({ active: e.target.value })}>
          <option value="active">Active</option>
          <option value="all">Active & inactive</option>
          <option value="inactive">Inactive</option>
        </select>
      </Filters>
      <DataTable
        rows={q.data?.items ?? []}
        columns={columns}
        rowKey={(c) => c.id}
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
        rowLink={(c) => `/customers/${c.id}`}
        empty="No customers yet — add your shops and medical centers."
        mobileCard={(c) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{c.name}</p>
              <p className="truncate text-xs text-stone-500">{c.typeName}{c.area ? ` · ${c.area}` : ''}{c.phone ? ` · ${c.phone}` : ''}</p>
            </div>
            <div className="shrink-0 text-right">
              {c.balance > 0.004 ? <p className={`font-semibold tabular-nums ${c.overdue > 0 ? 'text-red-600' : ''}`}>{rs(c.balance)}</p> : <p className="text-sm text-stone-400">settled</p>}
              {c.overdue > 0 && <p className="text-xs text-red-600">overdue</p>}
            </div>
          </div>
        )}
      />
      {editing && <CustomerForm customer={editing} onClose={() => setEditing(null)} />}
      {paying && <PaymentModal partyType="customer" partyId={paying} onClose={() => setPaying(null)} />}
    </div>
  )
}

const blankCustomer = (typeId: number): Customer => ({ id: 0, code: '', name: '', typeId, phone: '', address: '', area: '', discPct: null, creditLimit: 0, creditDays: null, notes: '', active: true })

export function CustomerForm({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const isNew = !customer.id
  const { data: types = [] } = useCustomerTypes()
  const [c, setC] = useState(customer)
  const [err, setErr] = useState('')
  const confirm = useConfirm()
  const type = types.find((t) => t.id === c.typeId)
  const save = useApiMutation((body: Customer) => (isNew ? api.post('/customers', body) : api.put(`/customers/${customer.id}`, body)), { success: isNew ? 'Customer added' : 'Customer saved', onSuccess: onClose, silentError: true })
  const del = useApiMutation(() => api.del(`/customers/${customer.id}`), { success: 'Customer deleted', onSuccess: onClose })
  const submit = () => {
    if (!c.name.trim()) return setErr('Name is required')
    if (!c.typeId) return setErr('Choose a customer type')
    const code = c.code.trim() || `C${Date.now().toString().slice(-6)}`
    save.mutate({ ...c, code }, { onError: (e) => setErr(e.message) })
  }
  return (
    <Modal
      open
      title={isNew ? 'Add customer' : `Edit ${customer.name}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {!isNew && <button className="btn-danger sm:mr-auto" onClick={async () => (await confirm({ title: `Delete ${customer.name}?`, message: 'Only possible when they have no invoices or payments. Otherwise mark them inactive.', tone: 'danger', confirmText: 'Delete' })) && del.mutate(undefined)}><Trash2 size={15} /> Delete</button>}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={save.isPending}>Save</button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shop / customer name *" className="sm:col-span-2"><input className="input" autoFocus value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="e.g. Siddhi Ayurveda Medical Center" /></Field>
        <Field label="Customer type *" hint={type ? `Default discount ${type.defaultDiscPct}% · ${type.creditDays} credit days` : undefined}>
          <select className="input" value={c.typeId || ''} onChange={(e) => setC({ ...c, typeId: Number(e.target.value) })}>
            <option value="">— select —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Code" hint="Leave empty to auto-create"><input className="input" value={c.code} onChange={(e) => setC({ ...c, code: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
        <Field label="Area / route"><input className="input" value={c.area} onChange={(e) => setC({ ...c, area: e.target.value })} placeholder="Matara" /></Field>
        <Field label="Address" className="sm:col-span-2"><input className="input" value={c.address} onChange={(e) => setC({ ...c, address: e.target.value })} /></Field>
        <Field label="Own discount %" hint="Empty = use the customer type discount"><NumberInput min={0} max={100} value={c.discPct} onChange={(v) => setC({ ...c, discPct: v })} placeholder={type ? `${type.defaultDiscPct} (type)` : ''} /></Field>
        <Field label="Credit days" hint="Empty = use the customer type setting"><NumberInput min={0} max={365} step={1} value={c.creditDays} onChange={(v) => setC({ ...c, creditDays: v == null ? null : Math.round(v) })} placeholder={type ? `${type.creditDays} (type)` : ''} /></Field>
        <Field label="Credit limit (Rs)" hint="0 = no limit"><NumberInput min={0} value={c.creditLimit} onChange={(v) => setC({ ...c, creditLimit: v ?? 0 })} /></Field>
        <Field label="Notes"><input className="input" value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4" checked={c.active} onChange={(e) => setC({ ...c, active: e.target.checked })} /> Active</label>
      </div>
      {err && <p className="mt-3 text-sm font-medium text-red-600">{err}</p>}
    </Modal>
  )
}

const statementCols: Column<StatementRow>[] = [
  { key: 'date', header: 'Date', render: (r) => <span className="text-stone-500">{r.date}</span> },
  { key: 'ref', header: 'Reference', render: (r) => r.ref },
  { key: 'type', header: 'Detail', render: (r) => <span className="text-stone-500">{r.type}{r.note ? ` · ${r.note}` : ''}</span> },
  { key: 'debit', header: 'Billed', align: 'right', render: (r) => (r.debit ? rs(r.debit) : '') },
  { key: 'credit', header: 'Paid', align: 'right', render: (r) => (r.credit ? <span className="text-brand-700">{rs(r.credit)}</span> : '') },
  { key: 'bal', header: 'Balance', align: 'right', render: (r) => <span className="font-medium">{rs(r.balance)}</span> },
]

interface InvRow { id: number; invoiceNo: string; date: string; netTotal: number; due: number; status: 'paid' | 'partial' | 'unpaid'; overdue: boolean; dueDate: string }

export function CustomerDetail() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['customers', id], queryFn: () => api.get<{ customer: CustomerWithBalance; statement: StatementRow[] }>(`/customers/${id}`) })
  const [tab, setTab] = useState<'invoices' | 'statement'>('invoices')
  const [ip, setIp] = useState({ page: 1, pageSize: 10 })
  const inv = usePaged<InvRow>('sales', '/sales', { customerId: id, ...ip, sort: 'date', dir: 'desc' })
  const [paying, setPaying] = useState(false)
  const [editing, setEditing] = useState(false)
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <ErrorBox error={q.error ?? 'Not found'} />
  const c = q.data.customer
  return (
    <div>
      <PageHeader
        back={{ to: '/customers', label: 'Customers' }}
        title={c.name}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone="blue">{c.typeName}</Badge>{[c.code, c.area, c.phone].filter(Boolean).join(' · ')}</span>}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button>
            <button className="btn-secondary" onClick={() => downloadExcel(`statement-${c.name.replace(/\W+/g, '-')}`, [{
              name: 'Statement',
              columns: [{ header: 'Date' }, { header: 'Reference' }, { header: 'Detail' }, { header: 'Billed', type: 'money' }, { header: 'Paid', type: 'money' }, { header: 'Balance', type: 'money' }],
              rows: q.data!.statement.map((r) => [r.date, r.ref, [r.type, r.note].filter(Boolean).join(' · '), r.debit || null, r.credit || null, r.balance]),
              totals: [3, 4],
            }])}><FileSpreadsheet size={15} /> Statement</button>
            <Link to={`/sales/new?customer=${c.id}`} className="btn-secondary"><Plus size={15} /> New sale</Link>
            <button className="btn-primary" onClick={() => setPaying(true)}><Wallet size={15} /> Receive payment</button>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total billed" value={`Rs ${rs(c.billed)}`} hint={`${c.invoices} invoices`} />
        <Stat label="Total paid" value={`Rs ${rs(c.paid)}`} tone="good" />
        <Stat label={c.balance < 0 ? 'Credit' : 'Balance'} value={`Rs ${rs(Math.abs(c.balance))}`} tone={c.overLimit ? 'bad' : c.balance > 0.004 ? 'warn' : 'default'} hint={c.creditLimit ? `Limit Rs ${rs(c.creditLimit)}` : 'No credit limit'} />
        <Stat label="Overdue" value={`Rs ${rs(c.overdue)}`} tone={c.overdue > 0 ? 'bad' : 'default'} hint={c.oldestDueDate ? `oldest due ${c.oldestDueDate}` : undefined} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'invoices', label: 'Invoices' }, { key: 'statement', label: 'Statement' }]} />
      {tab === 'invoices' ? (
        <DataTable
          rows={inv.data?.items ?? []}
          columns={[
            { key: 'no', header: 'Invoice', render: (r) => <Link className="font-medium text-brand-700 hover:underline" to={`/sales/${r.id}`}>{r.invoiceNo}</Link> },
            { key: 'date', header: 'Date', render: (r) => <span className="text-stone-500">{r.date}</span> },
            { key: 'duedate', header: 'Due by', hideBelow: 'lg', render: (r) => <span className="text-stone-500">{r.dueDate}</span> },
            { key: 'net', header: 'Net total', align: 'right', render: (r) => rs(r.netTotal) },
            { key: 'due', header: 'Due', align: 'right', render: (r) => (r.due > 0 ? rs(r.due) : '') },
            { key: 'st', header: 'Status', render: (r) => <StatusBadge status={r.status} overdue={r.overdue} /> },
          ]}
          rowKey={(r) => r.id}
          rowLink={(r) => `/sales/${r.id}`}
          loading={inv.isFetching}
          page={inv.data?.page ?? 1}
          pageSize={ip.pageSize}
          total={inv.data?.total ?? 0}
          onPage={(p) => setIp({ ...ip, page: p })}
          onPageSize={(n) => setIp({ page: 1, pageSize: n })}
          empty="No invoices yet."
        />
      ) : (
        <ClientTable rows={[...q.data.statement].reverse()} columns={statementCols} rowKey={(r) => `${r.type}-${r.ref}-${r.date}-${r.balance}`} empty="No transactions yet." />
      )}
      {paying && <PaymentModal partyType="customer" partyId={c.id} onClose={() => setPaying(false)} />}
      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} />}
    </div>
  )
}

// ================================================================ suppliers

export function SupplierList() {
  const [s, set] = useListState({ sort: 'name', dir: 'asc' as const })
  const q = usePaged<SupplierWithBalance, { payable: number }>('suppliers', '/suppliers', s)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [paying, setPaying] = useState<number | null>(null)
  const columns: Column<SupplierWithBalance>[] = [
    { key: 'name', header: 'Name', sortKey: 'name', render: (x) => <Link to={`/suppliers/${x.id}`} className="font-medium hover:underline">{x.name}</Link> },
    { key: 'phone', header: 'Phone', hideBelow: 'lg', render: (x) => <span className="text-stone-500">{x.phone}</span> },
    { key: 'inv', header: 'Invoices', sortKey: 'invoices', align: 'right', render: (x) => x.invoices },
    { key: 'billed', header: 'Billed', sortKey: 'billed', align: 'right', render: (x) => rs(x.billed) },
    { key: 'bal', header: 'To pay', sortKey: 'balance', align: 'right', render: (x) => (x.balance > 0.004 ? <Badge tone={x.overdue > 0 ? 'red' : 'amber'}>{rs(x.balance)}</Badge> : <span className="text-stone-300">0.00</span>) },
    {
      key: 'act', header: '', align: 'right', mobile: false,
      render: (x) => (
        <span className="inline-flex">
          <button className="btn-ghost" title="Pay" onClick={() => setPaying(x.id)}><Wallet size={15} /></button>
          <button className="btn-ghost" title="Edit" onClick={() => setEditing(x)}><Pencil size={15} /></button>
        </span>
      ),
    },
  ]
  return (
    <div>
      <PageHeader title="Suppliers" subtitle={`To pay: Rs ${rs(q.data?.summary.payable)}`} actions={<button className="btn-primary" onClick={() => setEditing({ id: 0, code: '', name: '', phone: '', address: '', creditDays: 0, notes: '', active: true })}><Plus size={16} /> Add supplier</button>} />
      <Filters><SearchBox value={s.search} onChange={(v) => set({ search: v })} /></Filters>
      <DataTable
        rows={q.data?.items ?? []}
        columns={columns}
        rowKey={(x) => x.id}
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
        rowLink={(x) => `/suppliers/${x.id}`}
      />
      {editing && <SupplierForm supplier={editing} onClose={() => setEditing(null)} />}
      {paying && <PaymentModal partyType="supplier" partyId={paying} onClose={() => setPaying(null)} />}
    </div>
  )
}

function SupplierForm({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const isNew = !supplier.id
  const [x, setX] = useState(supplier)
  const [err, setErr] = useState('')
  const confirm = useConfirm()
  const save = useApiMutation((body: Supplier) => (isNew ? api.post('/suppliers', body) : api.put(`/suppliers/${supplier.id}`, body)), { success: 'Supplier saved', onSuccess: onClose, silentError: true })
  const del = useApiMutation(() => api.del(`/suppliers/${supplier.id}`), { success: 'Supplier deleted', onSuccess: onClose })
  return (
    <Modal
      open
      title={isNew ? 'Add supplier' : `Edit ${supplier.name}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && <button className="btn-danger sm:mr-auto" onClick={async () => (await confirm({ title: `Delete ${supplier.name}?`, tone: 'danger', confirmText: 'Delete', message: 'Only possible when there are no invoices or payments.' })) && del.mutate(undefined)}><Trash2 size={15} /> Delete</button>}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => (x.name.trim() ? save.mutate({ ...x, code: x.code.trim() || `S${Date.now().toString().slice(-6)}` }, { onError: (e) => setErr(e.message) }) : setErr('Name is required'))}>Save</button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name *" className="sm:col-span-2"><input className="input" value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} /></Field>
        <Field label="Code"><input className="input" value={x.code} onChange={(e) => setX({ ...x, code: e.target.value })} /></Field>
        <Field label="Phone"><input className="input" value={x.phone} onChange={(e) => setX({ ...x, phone: e.target.value })} /></Field>
        <Field label="Address" className="sm:col-span-2"><input className="input" value={x.address} onChange={(e) => setX({ ...x, address: e.target.value })} /></Field>
        <Field label="Credit days" hint="Days you have to pay their invoices"><NumberInput min={0} step={1} value={x.creditDays} onChange={(v) => setX({ ...x, creditDays: Math.round(v ?? 0) })} /></Field>
        <Field label="Notes"><input className="input" value={x.notes} onChange={(e) => setX({ ...x, notes: e.target.value })} /></Field>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
    </Modal>
  )
}

export function SupplierDetail() {
  const { id } = useParams()
  const q = useQuery({ queryKey: ['suppliers', id], queryFn: () => api.get<{ supplier: SupplierWithBalance; statement: StatementRow[] }>(`/suppliers/${id}`) })
  const [paying, setPaying] = useState(false)
  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <ErrorBox error={q.error ?? 'Not found'} />
  const x = q.data.supplier
  const cols = statementCols.map((c) => (c.key === 'ref' ? { ...c, render: (r: StatementRow) => (r.refId && r.type === 'Invoice' ? <Link className="text-brand-700 hover:underline" to={`/purchases/${r.refId}`}>{r.ref}</Link> : r.ref) } : c))
  return (
    <div>
      <PageHeader back={{ to: '/suppliers', label: 'Suppliers' }} title={x.name} subtitle={[x.phone, x.address].filter(Boolean).join(' · ')} actions={<button className="btn-primary" onClick={() => setPaying(true)}><Wallet size={15} /> Pay supplier</button>} />
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Total billed" value={`Rs ${rs(x.billed)}`} hint={`${x.invoices} invoices`} />
        <Stat label="Paid" value={`Rs ${rs(x.paid)}`} tone="good" />
        <Stat label="To pay" value={`Rs ${rs(x.balance)}`} tone={x.balance > 0.004 ? 'warn' : 'default'} />
      </div>
      <h2 className="mb-2 font-semibold">Statement</h2>
      <ClientTable rows={[...q.data.statement].reverse()} columns={cols} rowKey={(r) => `${r.type}-${r.ref}-${r.date}-${r.balance}`} />
      {paying && <PaymentModal partyType="supplier" partyId={x.id} onClose={() => setPaying(false)} />}
    </div>
  )
}
