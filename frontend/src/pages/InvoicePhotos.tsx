import { useQuery } from '@tanstack/react-query'
import { FileInput, FileOutput, Images } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rs, type InvoiceImageRow } from '@pjd/shared'
import { Pagination } from '../components/DataTable'
import { Lightbox, PhotoImg } from '../components/InvoiceImages'
import { ErrorBox, Filters, PageHeader, SearchBox, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { useListState, usePaged } from '../lib/hooks'

/** Every photo of a paper invoice, newest first — tap to open, or jump to the invoice. */
export default function InvoicePhotos() {
  const [s, set] = useListState({ kind: '', sort: 'date', dir: 'desc' as const })
  const pageSize = s.pageSize === 25 ? 24 : s.pageSize // grid of 2/3/4/6 per row
  const q = usePaged<InvoiceImageRow>('gallery', '/images', { ...s, pageSize })
  const status = useQuery({ queryKey: ['images-status'], queryFn: () => api.get<{ ready: boolean; kind: 'blob' | 'local' }>('/images/status'), staleTime: 10 * 60_000 })
  const missing = useQuery({
    queryKey: ['gallery', 'missing'],
    queryFn: async () => {
      const [sa, pu] = await Promise.all([api.get<{ total: number }>('/sales', { images: 'none', pageSize: 1 }), api.get<{ total: number }>('/purchases', { images: 'none', pageSize: 1 })])
      return { sales: sa.total, purchases: pu.total }
    },
  })
  const [open, setOpen] = useState<number | null>(null)
  const items = q.data?.items ?? []
  const link = (r: InvoiceImageRow) => `/${r.kind === 'sale' ? 'sales' : 'purchases'}/${r.invoiceId}`

  return (
    <div>
      <PageHeader title="Invoice photos" subtitle="Photos of the paper invoices, kept with each invoice. Add photos on an invoice's page, or scan a new invoice." />
      {status.data && !status.data.ready && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Photo storage is not set up yet. In Vercel open <b>Storage → Create → Blob</b> (Private), connect it to this project and redeploy.</p>
      )}
      {missing.data && (missing.data.sales > 0 || missing.data.purchases > 0) && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {missing.data.purchases > 0 && <Link to="/purchases?images=none" className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-900 hover:bg-amber-100">{missing.data.purchases} purchase invoice{missing.data.purchases > 1 ? 's' : ''} without a photo →</Link>}
          {missing.data.sales > 0 && <Link to="/sales?images=none" className="rounded-full border border-stone-200 bg-white px-3 py-1 text-stone-700 hover:bg-stone-50">{missing.data.sales} sales invoice{missing.data.sales > 1 ? 's' : ''} without a photo →</Link>}
        </div>
      )}
      <Filters>
        <SearchBox value={s.search} onChange={(v) => set({ search: v })} placeholder="Invoice no, supplier, customer, date…" />
        <select className="input" value={s.kind} onChange={(e) => set({ kind: e.target.value })}>
          <option value="">Sales & purchases</option>
          <option value="purchase">Purchase invoices</option>
          <option value="sale">Sales invoices</option>
        </select>
        <select className="input" value={`${s.sort}-${s.dir}`} onChange={(e) => { const [sort, dir] = e.target.value.split('-'); set({ sort, dir: dir as 'asc' | 'desc' }) }}>
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="invoiceNo-asc">Invoice no</option>
          <option value="party-asc">Supplier / customer</option>
        </select>
      </Filters>
      {q.error ? <ErrorBox error={q.error} /> : q.isLoading ? <Spinner /> : !items.length ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center text-stone-500">
          <Images size={32} />
          <p>No photos{s.search || s.kind ? ' match' : ' yet'}.</p>
          <p className="text-sm">Open an invoice and press <b>Add photo</b>, or scan a new invoice — its photo is kept automatically.</p>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {items.map((r, i) => (
              <li key={r.id} className="card overflow-hidden">
                <button className="block h-44 w-full bg-stone-100" onClick={() => setOpen(i)} aria-label={`Open ${r.invoiceNo} page ${r.page}`}>
                  <PhotoImg imageId={r.id} rotation={r.rotation} thumb alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                </button>
                <Link to={link(r)} className="block p-2.5 text-sm hover:bg-stone-50">
                  <span className="flex items-center gap-1.5 font-medium text-brand-700">
                    {r.kind === 'purchase' ? <FileInput size={14} /> : <FileOutput size={14} />}
                    <span className="truncate">{r.invoiceNo}</span>
                    <span className="ml-auto shrink-0 text-xs font-normal text-stone-500">p{r.page}</span>
                  </span>
                  <span className="block truncate text-xs text-stone-600">{r.partyName}</span>
                  <span className="block text-xs text-stone-500">{r.date} · Rs {rs(r.netTotal)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="card mt-3">
            <Pagination page={q.data?.page ?? 1} pageSize={pageSize} total={q.data?.total ?? 0} onPage={(p) => set({ page: p }, false)} onPageSize={(n) => set({ pageSize: n })} pageSizes={[12, 24, 48, 96]} />
          </div>
        </>
      )}
      {open != null && items[open] && (
        <Lightbox images={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onRotated={() => q.refetch()} title={(r) => { const x = r as InvoiceImageRow; return `${x.invoiceNo} · page ${x.page} · ${x.partyName} · ${x.date}` }} />
      )}
    </div>
  )
}
