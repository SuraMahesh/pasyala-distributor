import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Inbox } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Empty, ErrorBox } from './ui'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** server sort key (or field for client tables) */
  sortKey?: string
  /** value used when sorting client-side */
  sortValue?: (row: T) => string | number | null
  align?: 'left' | 'right' | 'center'
  className?: string
  /** hide this column on narrower desktop widths */
  hideBelow?: 'lg' | 'xl' | '2xl'
  /** leave out of the default mobile card */
  mobile?: boolean
}

export interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  empty?: ReactNode
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize: (s: number) => void
  sort?: string
  dir?: 'asc' | 'desc'
  onSort?: (key: string, dir: 'asc' | 'desc') => void
  rowLink?: (row: T) => string
  rowClassName?: (row: T) => string
  /** custom card for phones; defaults to a label/value list built from the columns */
  mobileCard?: (row: T) => ReactNode
  footer?: ReactNode
  pageSizes?: number[]
}

const alignCls = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left')
const hideCls = (h?: string) => (h === 'lg' ? 'hidden lg:table-cell' : h === 'xl' ? 'hidden xl:table-cell' : h === '2xl' ? 'hidden 2xl:table-cell' : '')

export function DataTable<T>(p: DataTableProps<T>) {
  const nav = useNavigate()
  const {
    rows, columns, rowKey, loading, error, onRetry, empty, page, pageSize, total, onPage, onPageSize,
    sort, dir = 'asc', onSort, rowLink, rowClassName, mobileCard, footer, pageSizes = [10, 25, 50, 100],
  } = p

  if (error) return <ErrorBox error={error} onRetry={onRetry} />

  const header = (c: Column<T>) => {
    if (!c.sortKey || !onSort) return c.header
    const active = sort === c.sortKey
    const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <button
        className={`inline-flex items-center gap-1 uppercase hover:text-stone-800 ${active ? 'text-stone-800' : ''}`}
        onClick={() => onSort(c.sortKey!, active && dir === 'asc' ? 'desc' : 'asc')}
      >
        {c.header}
        <Icon size={12} className={active ? '' : 'opacity-40'} />
      </button>
    )
  }

  const go = (row: T) => rowLink && nav(rowLink(row))

  return (
    <div className="card overflow-hidden">
      <div className={`relative ${loading ? 'opacity-60 transition-opacity' : ''}`}>
        {/* phones: cards */}
        <ul className="divide-y divide-stone-100 md:hidden">
          {rows.map((row) => (
            <li
              key={rowKey(row)}
              className={`px-4 py-3 ${rowLink ? 'cursor-pointer active:bg-brand-50' : ''} ${rowClassName?.(row) ?? ''}`}
              onClick={() => go(row)}
            >
              {mobileCard ? mobileCard(row) : <DefaultCard row={row} columns={columns} />}
            </li>
          ))}
        </ul>

        {/* tablets/desktop: table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={`${alignCls(c.align)} ${hideCls(c.hideBelow)} ${c.className ?? ''}`}>{header(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)} className={`${rowLink ? 'cursor-pointer' : ''} ${rowClassName?.(row) ?? ''}`} onClick={(e) => {
                  if ((e.target as HTMLElement).closest('a,button,input,select,label')) return
                  go(row)
                }}>
                  {columns.map((c) => (
                    <td key={c.key} className={`${alignCls(c.align)} ${c.align === 'right' ? 'tabular-nums' : ''} ${hideCls(c.hideBelow)} ${c.className ?? ''}`}>{c.render(row)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer && <tfoot className="bg-stone-50 font-semibold">{footer}</tfoot>}
          </table>
        </div>

        {!loading && rows.length === 0 && <Empty icon={<Inbox size={28} />}>{empty ?? 'Nothing to show'}</Empty>}
        {loading && rows.length === 0 && <div className="py-10 text-center text-sm text-stone-500">Loading…</div>}
      </div>
      {total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPage={onPage} onPageSize={onPageSize} pageSizes={pageSizes} />}
    </div>
  )
}

function DefaultCard<T>({ row, columns }: { row: T; columns: Column<T>[] }) {
  const [first, ...rest] = columns.filter((c) => c.mobile !== false)
  return (
    <div>
      <div className="font-medium text-stone-900">{first.render(row)}</div>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rest.map((c) => (
          <div key={c.key} className="flex min-w-0 items-baseline justify-between gap-2">
            <dt className="shrink-0 text-xs text-stone-500">{c.header}</dt>
            <dd className="min-w-0 truncate text-right tabular-nums">{c.render(row)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, pageSizes = [10, 25, 50, 100] }: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize: (s: number) => void
  pageSizes?: number[]
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(page * pageSize, total)
  const nums = useMemo(() => {
    const set = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))
    return [...set].sort((a, b) => a - b)
  }, [page, pages])
  const btn = 'flex h-8 min-w-8 items-center justify-center rounded-md border border-stone-200 px-2 text-sm disabled:opacity-40 hover:bg-stone-50'
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-3 py-2.5 text-sm text-stone-600 md:px-4">
      <div className="flex items-center gap-2">
        <span className="tabular-nums">{from}–{to} of {total}</span>
        <select className="rounded-md border border-stone-200 bg-white px-1.5 py-1 text-sm" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
          {pageSizes.map((s) => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <button className={`${btn} hidden sm:flex`} disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page"><ChevronsLeft size={15} /></button>
          <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
          {nums.map((n, i) => (
            <span key={n} className="flex items-center gap-1">
              {i > 0 && n - nums[i - 1] > 1 && <span className="px-0.5 text-stone-400">…</span>}
              <button className={`${btn} ${n === page ? 'border-brand-700 bg-brand-700 text-white hover:bg-brand-700' : ''}`} onClick={() => onPage(n)}>{n}</button>
            </span>
          ))}
          <button className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
          <button className={`${btn} hidden sm:flex`} disabled={page >= pages} onClick={() => onPage(pages)} aria-label="Last page"><ChevronsRight size={15} /></button>
        </div>
      )}
    </div>
  )
}

/** DataTable for data already in memory (reports, statements, price grids). */
export function ClientTable<T>(props: Omit<DataTableProps<T>, 'page' | 'pageSize' | 'total' | 'onPage' | 'onPageSize' | 'sort' | 'dir' | 'onSort'> & { initialPageSize?: number; initialSort?: { key: string; dir: 'asc' | 'desc' } }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(props.initialPageSize ?? 25)
  const [sort, setSort] = useState(props.initialSort?.key ?? '')
  const [dir, setDir] = useState<'asc' | 'desc'>(props.initialSort?.dir ?? 'asc')
  const sorted = useMemo(() => {
    const col = props.columns.find((c) => c.sortKey === sort)
    if (!col?.sortValue) return props.rows
    const m = dir === 'asc' ? 1 : -1
    return [...props.rows].sort((a, b) => {
      const x = col.sortValue!(a)
      const y = col.sortValue!(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * m
      return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }) * m
    })
  }, [props.rows, props.columns, sort, dir])
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pages)
  return (
    <DataTable
      {...props}
      rows={sorted.slice((current - 1) * pageSize, current * pageSize)}
      page={current}
      pageSize={pageSize}
      total={sorted.length}
      onPage={setPage}
      onPageSize={(s) => { setPageSize(s); setPage(1) }}
      sort={sort}
      dir={dir}
      onSort={(k, d) => { setSort(k); setDir(d); setPage(1) }}
    />
  )
}
