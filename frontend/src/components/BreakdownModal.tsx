import type { ReactNode } from 'react'
import { ClientTable, type Column } from './DataTable'
import { Modal, Spinner } from './ui'

/** A figure's invoice-by-invoice table in a window (opened by clicking a Stat tile). */
export function BreakdownModal<T>({ title, subtitle, columns, rows, rowKey, footer, totals, loading, initialSort, onClose }: {
  title: string
  subtitle?: ReactNode
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  /** totals row for the table (tablets / desktop) */
  footer?: ReactNode
  /** the same totals as label / value pairs — shown as a card under the list on phones */
  totals?: { label: string; value: ReactNode }[]
  loading?: boolean
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  onClose: () => void
}) {
  const mobileFooter = totals?.length ? (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
      {totals.map((t) => (
        <div key={t.label} className="contents">
          <dt className="text-stone-500">{t.label}</dt>
          <dd className="text-right tabular-nums">{t.value}</dd>
        </div>
      ))}
    </dl>
  ) : undefined
  return (
    <Modal open onClose={onClose} title={title} size="xl">
      {subtitle && <div className="mb-3 text-sm text-stone-500">{subtitle}</div>}
      {loading ? <Spinner /> : <ClientTable rows={rows} columns={columns} rowKey={rowKey} footer={footer} mobileFooter={mobileFooter} initialPageSize={25} initialSort={initialSort} empty="Nothing in this selection." />}
    </Modal>
  )
}

/** footer cell helper: right-aligned money/number cell */
export const Td = ({ children, className = "" }: { children: ReactNode; className?: string }) => <td className={`text-right tabular-nums ${className}`}>{children}</td>
