import { Loader2, Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { InvoiceStatus } from '@pjd/shared'

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="no-print mb-4 md:mb-5">
      {back && (
        <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-stone-900 md:text-2xl">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
      </div>
    </div>
  )
}

export function Stat({ label, value, hint, tone = 'default', icon, to }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'good' | 'warn' | 'bad'
  icon?: ReactNode
  to?: string
}) {
  const toneCls = { default: 'text-stone-900', good: 'text-brand-700', warn: 'text-amber-600', bad: 'text-red-600' }[tone]
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium tracking-wide text-stone-500 uppercase md:text-xs">{label}</p>
        {icon && <span className="shrink-0 text-stone-400">{icon}</span>}
      </div>
      <p className={`mt-1.5 truncate text-lg font-semibold tabular-nums md:text-2xl ${toneCls}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-stone-500">{hint}</p>}
    </>
  )
  return to ? (
    <Link to={to} className="card block p-3 transition hover:border-brand-200 hover:shadow md:p-4">{body}</Link>
  ) : (
    <div className="card p-3 md:p-4">{body}</div>
  )
}

export type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue'
export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: Tone }) {
  const cls = {
    gray: 'bg-stone-100 text-stone-700',
    green: 'bg-brand-100 text-brand-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-sky-100 text-sky-800',
  }[tone]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>{children}</span>
}

export function StatusBadge({ status, overdue }: { status: InvoiceStatus; overdue?: boolean }) {
  if (status === 'paid') return <Badge tone="green">Paid</Badge>
  if (overdue) return <Badge tone="red">Overdue</Badge>
  return <Badge tone="amber">{status === 'partial' ? 'Part paid' : 'Unpaid'}</Badge>
}

export function StockBadge({ onHand, reorderLevel }: { onHand: number; reorderLevel: number }) {
  return <Badge tone={onHand <= 0 ? 'red' : onHand <= reorderLevel ? 'amber' : 'green'}>{onHand}</Badge>
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  const w = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size]
  return createPortal(
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-start sm:p-4 sm:pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-h-[84vh] sm:rounded-xl ${w}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 sm:px-5">
          <h2 className="truncate font-semibold text-stone-900">{title}</h2>
          <button className="btn-ghost -mr-2" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-stone-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 [&>*]:flex-1 sm:[&>*]:flex-none">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Field({ label, children, className = '', hint, error }: { label: string; children: ReactNode; className?: string; hint?: ReactNode; error?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  )
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-stone-500">
      {icon && <span className="text-stone-300">{icon}</span>}
      {children}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-500">
      <Loader2 size={18} className="animate-spin" /> {label}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">Could not load this page</p>
      <p className="mt-1">{error instanceof Error ? error.message : String(error)}</p>
      {onRetry && <button className="btn-secondary mt-3" onClick={onRetry}>Try again</button>}
    </div>
  )
}

/** Debounced search input; calls onChange 300ms after typing stops. */
export function SearchBox({ value, onChange, placeholder = 'Search…', className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value)
  const first = useRef(true)
  useEffect(() => setV(value), [value])
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => v !== value && onChange(v), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v])
  return (
    <div className={`relative w-full sm:w-72 ${className}`}>
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
      <input className="input pl-9" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} type="search" />
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { key: T; label: ReactNode }[] }) {
  return (
    <div className="no-print -mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex gap-1 rounded-lg bg-stone-200/60 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition ${value === t.key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Filters({ children }: { children: ReactNode }) {
  return <div className="no-print mb-3 flex flex-wrap items-center gap-2 [&_select]:w-auto [&_select]:min-w-0 [&_select]:flex-1 sm:[&_select]:flex-none">{children}</div>
}

/** Number input that allows clearing the field while typing. */
export function NumberInput({ value, onChange, className = '', min, max, step, ...rest }: {
  value: number | null
  onChange: (v: number | null) => void
  className?: string
  min?: number
  max?: number
  step?: number | string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  'aria-label'?: string
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => {
    if ((text === '' ? null : Number(text)) !== value) setText(value == null ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      className={`input text-right tabular-nums ${className}`}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setText(e.target.value)
        onChange(e.target.value === '' ? null : Number(e.target.value))
      }}
    />
  )
}
