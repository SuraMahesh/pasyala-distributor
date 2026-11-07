import type { ReactNode } from 'react'
import { ClientTable, type Column } from './DataTable'
import { Modal, Spinner } from './ui'

/** A figure's invoice-by-invoice table in a window (opened by clicking a Stat tile). */
export function BreakdownModal<T>({ title, subtitle, columns, rows, rowKey, footer, loading, initialSort, onClose }: {
  title: string
  subtitle?: ReactNode
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  footer?: ReactNode
  loading?: boolean
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  onClose: () => void
}) {
  return (
    <Modal open onClose={onClose} title={title} size="xl">
      {subtitle && <p className="mb-3 text-sm text-stone-500">{subtitle}</p>}
      {loading ? <Spinner /> : <ClientTable rows={rows} columns={columns} rowKey={rowKey} footer={footer} initialPageSize={25} initialSort={initialSort} empty="Nothing in this selection." />}
    </Modal>
  )
}

/** footer cell helper: right-aligned money/number cell */
export const Td = ({ children, className = "" }: { children: ReactNode; className?: string }) => <td className={`text-right tabular-nums ${className}`}>{children}</td>
