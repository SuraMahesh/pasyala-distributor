import { ArrowDownLeft, ArrowUpRight, FileSpreadsheet, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PAY_METHODS, rs, todayLK, type PayMethod } from '@pjd/shared'
import Combobox from '../components/Combobox'
import { useConfirm } from '../components/Confirm'
import { DataTable, type Column } from '../components/DataTable'
import { Badge, Field, Filters, Modal, NumberInput, PageHeader, SearchBox, Stat } from '../components/ui'
import { api, fetchAll } from '../lib/api'
import { downloadExcel } from '../lib/excel'
import { useApiMutation, useCustomerOptions, useListState, usePaged, useSupplierOptions } from '../lib/hooks'

interface PaymentRow {
  id: number
  date: string
  partyType: 'customer' | 'supplier'
  partyId: number
  partyName: string
  amount: number
  method: string
  reference: string
  notes: string
}

export default function Payments() {
  const [s, set] = useListState({ partyType: '', method: '', from: '', to: '', sort: 'date', dir: 'desc' as const })
  const q = usePaged<PaymentRow, { received: number; paidOut: number }>('payments', '/payments', s)
  const [open, setOpen] = useState<'customer' | 'supplier' | null>(null)
  const confirm = useConfirm()
  const del = useApiMutation((id: number) => api.del(`/payments/${id}`), { success: 'Payment deleted' })

  const columns: Column<PaymentRow>[] = [
    { key: 'date', header: 'Date', sortKey: 'date', render: (r) => <span className="text-stone-500">{r.date}</span> },
    { key: 'type', header: 'Type', render: (r) => (r.partyType === 'customer' ? <Badge tone="green">Received</Badge> : <Badge tone="blue">Paid out</Badge>) },
    { key: 'party', header: 'From / to', sortKey: 'party', render: (r) => <Link className="hover:underline" to={`/${r.partyType}s/${r.partyId}`}>{r.partyName}</Link> },
    { key: 'method', header: 'Method', render: (r) => r.method },
    { key: 'ref', header: 'Reference', hideBelow: 'lg', render: (r) => <span className="text-stone-500">{[r.reference, r.notes].filter(Boolean).join(' · ')}</span> },
    { key: 'amount', header: 'Amount', sortKey: 'amount', align: 'right', render: (r) => <span className="font-medium">{rs(r.amount)}</span> },
    {
      key: 'del', header: '', align: 'right', mobile: false,
      render: (r) => (
        <button
          className="btn-ghost hover:text-red-600"
          aria-label="Delete payment"
          onClick={async () => (await confirm({ title: 'Delete this payment?', message: `Rs ${rs(r.amount)} ${r.partyType === 'customer' ? 'from' : 'to'} ${r.partyName} on ${r.date}. Their balance goes back up.`, confirmText: 'Delete', tone: 'danger' })) && del.mutate(r.id)}
        >
          <Trash2 size={15} />
        </button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Money received from customers and paid to suppliers (besides what was paid on the invoice itself)"
        actions={
          <>
            <button className="btn-secondary" onClick={async () => {
              const all = await fetchAll<PaymentRow>('/payments', { ...s, page: undefined, pageSize: undefined })
              await downloadExcel('payments', [{
                name: 'Payments',
                columns: [{ header: 'Date' }, { header: 'Type' }, { header: 'From / to' }, { header: 'Method' }, { header: 'Reference' }, { header: 'Note' }, { header: 'Received', type: 'money' }, { header: 'Paid out', type: 'money' }],
                rows: all.map((r) => [r.date, r.partyType === 'customer' ? 'Received' : 'Paid out', r.partyName, r.method, r.reference, r.notes, r.partyType === 'customer' ? r.amount : null, r.partyType === 'supplier' ? r.amount : null]),
                totals: [6, 7],
              }])
            }}><FileSpreadsheet size={16} /> Excel</button>
            <button className="btn-secondary" onClick={() => setOpen('supplier')}><ArrowUpRight size={16} /> Pay supplier</button>
            <button className="btn-primary" onClick={() => setOpen('customer')}><ArrowDownLeft size={16} /> Receive payment</button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Stat label="Received (filtered)" value={`Rs ${rs(q.data?.summary.received)}`} tone="good" />
        <Stat label="Paid out (filtered)" value={`Rs ${rs(q.data?.summary.paidOut)}`} />
      </div>
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Name, cheque no, note…" />
        <select className="input" value={s.partyType} onChange={(e) => set({ partyType: e.target.value })}>
          <option value="">Received & paid out</option>
          <option value="customer">Received from customers</option>
          <option value="supplier">Paid to suppliers</option>
        </select>
        <select className="input" value={s.method} onChange={(e) => set({ method: e.target.value })}>
          <option value="">All methods</option>
          {PAY_METHODS.filter((m) => m !== 'Credit').map((m) => <option key={m}>{m}</option>)}
        </select>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:w-auto">
          <input type="date" className="input" value={s.from} onChange={(e) => set({ from: e.target.value })} aria-label="From" />
          <span className="text-stone-400">to</span>
          <input type="date" className="input" value={s.to} onChange={(e) => set({ to: e.target.value })} aria-label="To" />
        </div>
      </Filters>
      <DataTable
        rows={q.data?.items ?? []}
        columns={columns}
        rowKey={(r) => r.id}
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
        empty="No payments recorded yet."
        mobileCard={(r) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {r.partyType === 'customer' ? <Badge tone="green">In</Badge> : <Badge tone="blue">Out</Badge>}
                <span className="truncate font-medium">{r.partyName}</span>
              </div>
              <p className="mt-0.5 text-xs text-stone-500">{r.date} · {r.method}{r.reference ? ` · ${r.reference}` : ''}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="font-semibold tabular-nums">{rs(r.amount)}</span>
              {columns[6].render(r)}
            </div>
          </div>
        )}
      />
      {open && <PaymentModal partyType={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

export function PaymentModal({ partyType, partyId, defaultAmount, reference: ref0 = '', onClose }: {
  partyType: 'customer' | 'supplier'
  partyId?: number
  defaultAmount?: number
  reference?: string
  onClose: () => void
}) {
  const { data: customers = [] } = useCustomerOptions()
  const { data: suppliers = [] } = useSupplierOptions()
  const all: { id: number; code: string; name: string; balance: number; active: boolean }[] = partyType === 'customer' ? customers : suppliers
  const list = all.filter((p) => p.active || p.id === partyId)
  const [pid, setPid] = useState<number | null>(partyId ?? null)
  const party = list.find((p) => p.id === pid)
  const [amount, setAmount] = useState<number | null>(defaultAmount ?? null)
  const [method, setMethod] = useState<PayMethod>('Cash')
  const [date, setDate] = useState(todayLK())
  const [reference, setReference] = useState(ref0)
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const confirm = useConfirm()
  const amt = amount ?? (party ? Math.max(party.balance, 0) : 0)
  const save = useApiMutation((body: unknown) => api.post('/payments', body), { success: partyType === 'customer' ? 'Payment received' : 'Supplier payment saved', onSuccess: onClose })

  const submit = async () => {
    if (!pid) return setErr(`Choose a ${partyType}`)
    if (!(amt > 0)) return setErr('Enter an amount more than 0')
    if (method !== 'Cash' && method !== 'Bank Transfer' && !reference.trim()) return setErr('Enter the cheque number')
    setErr('')
    if (party && amt > Math.max(party.balance, 0) + 0.004) {
      const ok = await confirm({
        title: 'Amount is more than the balance',
        message: `${party.name} owes Rs ${rs(Math.max(party.balance, 0))}. The extra Rs ${rs(amt - Math.max(party.balance, 0))} will be kept as credit for future invoices.`,
        confirmText: 'Save anyway',
        tone: 'warning',
      })
      if (!ok) return
    }
    save.mutate({ partyType, partyId: pid, amount: amt, method, date, reference, notes })
  }

  return (
    <Modal
      open
      title={partyType === 'customer' ? 'Receive payment' : 'Pay supplier'}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={save.isPending}><Plus size={16} /> Save payment</button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={partyType === 'customer' ? 'Customer' : 'Supplier'} className="sm:col-span-2">
          <Combobox
            items={list}
            value={pid}
            onChange={(id, p) => {
              setPid(id)
              if (amount == null) setAmount(Math.max(p.balance, 0) || null)
            }}
            getId={(p) => p.id}
            getLabel={(p) => p.name}
            getSearch={(p) => `${p.code} ${p.name}`}
            renderItem={(p) => (
              <div className="flex justify-between gap-2"><span className="truncate">{p.name}</span><span className="shrink-0 text-xs text-stone-500 tabular-nums">owes {rs(Math.max(p.balance, 0))}</span></div>
            )}
          />
        </Field>
        <Field label="Amount (Rs)"><NumberInput min={0} step="0.01" value={amount ?? (party ? Math.max(party.balance, 0) : null)} onChange={setAmount} /></Field>
        <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Method">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
            {PAY_METHODS.filter((m) => m !== 'Credit').map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label={method === 'Cheque' ? 'Cheque no *' : 'Reference'}><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Note" className="sm:col-span-2"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {party && (
        <p className="mt-4 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
          Balance Rs {rs(party.balance)} → <b>Rs {rs(party.balance - amt)}</b>
          {partyType === 'customer' && <span className="block text-xs text-stone-500">Applied to the oldest unpaid invoices first.</span>}
        </p>
      )}
      {err && <p className="mt-3 text-sm font-medium text-red-600">{err}</p>}
    </Modal>
  )
}
