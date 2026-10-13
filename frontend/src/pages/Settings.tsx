import { FileSpreadsheet, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import type { Settings as S } from '@pjd/shared'
import { useConfirm } from '../components/Confirm'
import { Field, NumberInput, PageHeader, Spinner } from '../components/ui'
import { api, authHeaders } from '../lib/api'
import { downloadExcel, type XCell, type XSheet } from '../lib/excel'
import { useApiMutation, useSettings } from '../lib/hooks'

export default function Settings() {
  const { data, isLoading } = useSettings()
  const [form, setForm] = useState<S | null>(null)
  const confirm = useConfirm()
  useEffect(() => {
    if (data) setForm(data)
  }, [data])
  const save = useApiMutation((body: S) => api.put('/settings', body), { success: 'Settings saved' })
  if (isLoading || !form) return <Spinner />
  const set = (p: Partial<S>) => setForm({ ...form, ...p })

  const submit = async () => {
    if (form.allowNegativeStock && !data?.allowNegativeStock) {
      const ok = await confirm({ title: 'Allow selling without stock?', message: 'Invoices will save even when the system shows not enough stock, and stock can go negative. Use only while you are still entering opening stock.', tone: 'warning', confirmText: 'Allow' })
      if (!ok) return
    }
    if (data && form.nextInvoiceNo < data.nextInvoiceNo) {
      const ok = await confirm({ title: 'Go back to an earlier invoice number?', message: 'Numbers already used are skipped automatically, but this is unusual.', tone: 'warning', confirmText: 'Save' })
      if (!ok) return
    }
    save.mutate(form)
  }

  /** Whole database as one Excel workbook — one sheet per table, ids turned into names. */
  const exportAll = async () => {
    try {
      const res = await fetch(api.url('/export'), { headers: authHeaders() })
      if (!res.ok) throw new Error('Export failed')
      const d = (await res.json()) as Record<string, Record<string, unknown>[]>
      const name = (list: Record<string, unknown>[] | undefined, label: (r: Record<string, unknown>) => string) => new Map((list ?? []).map((r) => [r.id, label(r)]))
      const lookups: Record<string, [string, Map<unknown, string>]> = {
        productId: ['Item', name(d.products, (r) => `${r.code} ${r.size} ${r.name}`)],
        customerId: ['Customer', name(d.customers, (r) => String(r.name))],
        supplierId: ['Supplier', name(d.suppliers, (r) => String(r.name))],
        typeId: ['Customer type', name(d.customerTypes, (r) => String(r.name))],
        customerTypeId: ['Customer type', name(d.customerTypes, (r) => String(r.name))],
      }
      const invoiceNos = { salesLines: name(d.salesInvoices, (r) => String(r.invoiceNo)), purchaseLines: name(d.purchaseInvoices, (r) => String(r.invoiceNo)) }
      const titles: Record<string, string> = {
        products: 'Products', customerTypes: 'Customer types', customers: 'Customers', suppliers: 'Suppliers', priceRules: 'Price rules',
        promotions: 'Free issues', salesInvoices: 'Sales invoices', salesLines: 'Sales lines', purchaseInvoices: 'Purchases',
        purchaseLines: 'Purchase lines', payments: 'Payments', stockAdjustments: 'Stock adjustments', settings: 'Settings',
      }
      const sheets: XSheet[] = Object.entries(titles).map(([key, title]) => {
        const rows = d[key] ?? []
        const keys = rows.length ? Object.keys(rows[0]) : ['id']
        const cols: { header: string; get: (r: Record<string, unknown>) => XCell; type?: 'money' | 'int' }[] = []
        for (const k of keys) {
          if (k === 'invoiceId' && key in invoiceNos) {
            const m = invoiceNos[key as keyof typeof invoiceNos]
            cols.push({ header: 'Invoice no', get: (r) => m.get(r[k]) })
            continue
          }
          const sample = rows.find((r) => r[k] != null)?.[k]
          cols.push({ header: k, get: (r) => r[k] as XCell, type: typeof sample === 'number' && !/id$|Id$|no$|No$|days|Days|qty|Qty|sort|stock|Stock|level|Level/.test(k) ? 'money' : typeof sample === 'number' ? 'int' : undefined })
          if (lookups[k]) cols.push({ header: lookups[k][0], get: (r) => lookups[k][1].get(r[k]) })
        }
        return { name: title, columns: cols.map((c) => ({ header: c.header, type: c.type })), rows: rows.map((r) => cols.map((c) => c.get(r))) }
      })
      await downloadExcel('pasyala-erp-full-export', sheets)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <section className="card p-4 md:p-5">
        <h2 className="mb-4 font-semibold">Business details (printed on invoices)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" className="sm:col-span-2"><input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Address" className="sm:col-span-2"><input className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></Field>
          <Field label="Invoice prefix"><input className="input" value={form.invoicePrefix} onChange={(e) => set({ invoicePrefix: e.target.value })} /></Field>
          <Field label="Next invoice number" hint={`Next: ${form.invoicePrefix}${String(form.nextInvoiceNo).padStart(6, '0')}`}><NumberInput min={1} step={1} value={form.nextInvoiceNo} onChange={(v) => set({ nextInvoiceNo: Math.max(1, Math.round(v ?? 1)) })} /></Field>
          <Field label="Our customer code at the supplier" hint="Printed on purchase (GRN) copies"><input className="input" value={form.supplierCustomerCode} onChange={(e) => set({ supplierCustomerCode: e.target.value })} /></Field>
          <Field label="Invoice footer"><input className="input" value={form.footerNote} onChange={(e) => set({ footerNote: e.target.value })} /></Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.allowNegativeStock} onChange={(e) => set({ allowNegativeStock: e.target.checked })} />
            <span>Allow saving invoices when there is not enough stock <span className="block text-xs text-stone-500">Off = the system refuses to oversell (recommended).</span></span>
          </label>
        </div>
        <div className="mt-5">
          <button className="btn-primary" onClick={submit} disabled={save.isPending}><Save size={16} /> Save settings</button>
        </div>
      </section>

      <section className="card mt-5 p-4 md:p-5">
        <h2 className="font-semibold">Customer types, discounts & free issues</h2>
        <p className="mt-1 text-sm text-stone-600">Set these under <Link className="text-brand-700 hover:underline" to="/pricing">Prices & discounts</Link>.</p>
      </section>

      <section className="card mt-5 p-4 md:p-5">
        <h2 className="font-semibold">Data & backup</h2>
        <p className="mt-1 mb-4 text-sm text-stone-600">
          Everything is stored in the PostgreSQL database. Back it up daily with <code className="rounded bg-stone-100 px-1">pg_dump</code> (see README). You can also download everything as one Excel file (one sheet per table).
        </p>
        <button className="btn-secondary" onClick={exportAll}><FileSpreadsheet size={16} /> Download full Excel export</button>
      </section>
    </div>
  )
}
