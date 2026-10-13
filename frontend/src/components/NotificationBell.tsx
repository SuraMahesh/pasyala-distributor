import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AlertLevel } from '@pjd/shared'
import { useAlerts } from '../lib/hooks'

const ICON: Record<AlertLevel, typeof Info> = { danger: AlertCircle, warning: AlertTriangle, info: Info }
const COLOR: Record<AlertLevel, string> = { danger: 'text-red-600', warning: 'text-amber-600', info: 'text-sky-600' }

/** Bell with live alerts: stock outs, low stock, overdue customers, credit limits, supplier dues, promotions ending. */
export default function NotificationBell({ variant = 'icon' }: { variant?: 'icon' | 'sidebar' }) {
  const { data = [] } = useAlerts()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const urgent = data.filter((a) => a.level !== 'info').length

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      {variant === 'sidebar' ? (
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-brand-100 transition hover:bg-brand-800 hover:text-white"
          onClick={() => setOpen((o) => !o)}
          aria-label={`Notifications (${data.length})`}
        >
          <Bell size={18} />
          <span className="flex-1 text-left">Notifications</span>
          {data.length > 0 && (
            <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white ${urgent ? 'bg-red-600' : 'bg-sky-600'}`}>{data.length > 99 ? '99+' : data.length}</span>
          )}
        </button>
      ) : (
        <button
          className="relative rounded-lg p-2 text-stone-600 transition hover:bg-stone-100"
          onClick={() => setOpen((o) => !o)}
          aria-label={`Notifications (${data.length})`}
        >
          <Bell size={20} />
          {data.length > 0 && (
            <span className={`absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white ${urgent ? 'bg-red-600' : 'bg-sky-600'}`}>
              {data.length > 99 ? '99+' : data.length}
            </span>
          )}
        </button>
      )}
      {open && (
        <div className={`z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-stone-200 bg-white text-stone-800 shadow-xl ${variant === 'sidebar' ? 'absolute top-0 left-full ml-3 w-96' : 'fixed inset-x-2 top-14 sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-96'}`}>
          <div className="sticky top-0 border-b border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold">Notifications</div>
          {data.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-6 text-sm text-stone-500"><CheckCircle2 size={18} className="text-brand-600" /> All good — nothing needs attention.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {data.map((a) => {
                const Icon = ICON[a.level]
                return (
                  <li key={a.id}>
                    <Link to={a.link} onClick={() => setOpen(false)} className="flex gap-3 px-4 py-3 hover:bg-stone-50">
                      <Icon size={18} className={`mt-0.5 shrink-0 ${COLOR[a.level]}`} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{a.title}</span>
                        <span className="block truncate text-xs text-stone-500">{a.message}</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
