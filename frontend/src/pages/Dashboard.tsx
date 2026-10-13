import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  ChevronRight,
  FileOutput,
  Phone,
  Plus,
  SlidersHorizontal,
  Tags,
  Truck,
  UserPlus,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { qtyFmt, rs } from '@pjd/shared'
import { Badge, ErrorBox, Spinner } from '../components/ui'
import { api } from '../lib/api'
import { CustomerForm } from './Parties'
import { PaymentModal } from './Payments'
import { AdjustModal } from './Stock'

interface DashboardData {
  today: { revenue: number; invoices: number; collected: number; yesterday: number }
  month: { revenue: number; profit: number; invoices: number; lastMonthSameDays: number; lastMonthProfit: number }
  last30: { date: string; revenue: number; invoices: number }[]
  toCollect: { id: number; name: string; typeName: string; phone: string; balance: number; overdue: number; oldestDueDate: string | null; overLimit: boolean }[]
  counts: { customers: number; products: number }
  stock: { costValue: number; sellValue: number; units: number; low: number; out: number }
  receivable: number
  overdue: number
  payable: number
  recent: { id: number; invoiceNo: string; date: string; netTotal: number; customerName: string; typeName: string }[]
  topProducts: { productId: number; label: string; revenue: number; qty: number }[]
  byType: { name: string; revenue: number }[]
  lowStock: { id: number; code: string; label: string; onHand: number; reorderLevel: number }[]
}

/** Sri Lanka time of day for the greeting */
function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Colombo' }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const short = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(Math.round(n)))
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-LK', { day: 'numeric', month: 'short' })

export default function Dashboard() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard'), refetchInterval: 60_000 })
  const [modal, setModal] = useState<'pay' | 'adjust' | 'customer' | null>(null)
  const [payFor, setPayFor] = useState<number | undefined>()

  if (q.isLoading) return <Spinner />
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const d = q.data
  const overdueCustomers = d.toCollect.filter((c) => c.overdue > 0).length
  const overLimit = d.toCollect.filter((c) => c.overLimit).length

  return (
    <div className="space-y-5">
      {/* greeting */}
      <div className="no-print">
        <h1 className="text-xl font-semibold tracking-tight text-stone-900 md:text-2xl">{greeting()} 👋</h1>
        <p className="mt-0.5 text-sm text-stone-500">{new Date().toLocaleDateString('en-LK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {overdueCustomers > 0 && <Chip to="/customers?status=overdue" tone="red">{overdueCustomers} customer{overdueCustomers > 1 ? 's' : ''} overdue</Chip>}
          {overLimit > 0 && <Chip to="/customers?status=overLimit" tone="red">{overLimit} over credit limit</Chip>}
          {d.stock.out > 0 && <Chip to="/stock?stock=out" tone="red">{d.stock.out} out of stock</Chip>}
          {d.stock.low > 0 && <Chip to="/stock?stock=low" tone="amber">{d.stock.low} running low</Chip>}
          {overdueCustomers + overLimit + d.stock.out + d.stock.low === 0 && <span className="rounded-full bg-brand-100 px-2.5 py-1 font-medium text-brand-800">✓ Nothing needs attention</span>}
        </div>
      </div>

      {/* quick actions */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6">
        <Action to="/sales/new" icon={Plus} label="New sale" primary />
        <Action onClick={() => { setPayFor(undefined); setModal('pay') }} icon={Wallet} label="Receive payment" />
        <Action onClick={() => setModal('customer')} icon={UserPlus} label="Add customer" />
        <Action to="/purchases/new" icon={Truck} label="Enter purchase" />
        <Action onClick={() => setModal('adjust')} icon={SlidersHorizontal} label="Adjust stock" />
        <Action to="/pricing?tab=grid" icon={Tags} label="Price lists" />
      </div>

      {/* key numbers */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          to="/sales"
          icon={FileOutput}
          label="Today's sales"
          value={`Rs ${rs(d.today.revenue)}`}
          trend={change(d.today.revenue, d.today.yesterday)}
          trendLabel="vs yesterday"
          sub={`${d.today.invoices} invoice${d.today.invoices === 1 ? '' : 's'} · collected Rs ${rs(d.today.collected)}`}
        />
        <Kpi
          to="/reports"
          icon={ArrowUpRight}
          label="This month"
          value={`Rs ${rs(d.month.revenue)}`}
          trend={change(d.month.revenue, d.month.lastMonthSameDays)}
          trendLabel="vs last month"
          sub={<>Profit <span className="font-medium text-brand-700">Rs {rs(d.month.profit)}</span></>}
        />
        <Kpi
          to="/customers?status=owing"
          icon={Wallet}
          label="To collect"
          value={`Rs ${rs(d.receivable)}`}
          tone={d.overdue > 0 ? 'bad' : d.receivable > 0 ? 'warn' : undefined}
          sub={d.overdue > 0 ? <span className="font-medium text-red-600">Rs {rs(d.overdue)} overdue</span> : 'Nothing overdue'}
        />
        <Kpi
          to="/stock"
          icon={Boxes}
          label="Stock value"
          value={`Rs ${rs(d.stock.costValue)}`}
          sub={`${qtyFmt(d.stock.units)} units · Rs ${rs(d.stock.sellValue)} at selling price`}
        />
      </div>

      {/* sales trend + who owes */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] [&>*]:min-w-0">
        <Card title="Sales — last 30 days" action={<Link to="/reports?tab=daily" className="text-sm text-brand-700 hover:underline">Daily report</Link>}>
          <SalesChart data={d.last30} />
        </Card>

        <Card
          title={<span className="flex items-center gap-2">Collect money {d.toCollect.length > 0 && <Badge tone={d.overdue > 0 ? 'red' : 'amber'}>{d.toCollect.length}</Badge>}</span>}
          action={<Link to="/reports?tab=aging" className="text-sm text-brand-700 hover:underline">Aging</Link>}
        >
          {d.toCollect.length === 0 ? (
            <EmptyNote>No customer owes you money. 🎉</EmptyNote>
          ) : (
            <ul className="-mx-4 divide-y divide-stone-100">
              {d.toCollect.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Link to={`/customers/${c.id}`} className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate text-sm font-medium hover:underline">{c.name}{c.overLimit && <Badge tone="red">over limit</Badge>}</span>
                    <span className="block truncate text-xs text-stone-500">
                      {c.overdue > 0 ? <span className="text-red-600">Rs {rs(c.overdue)} overdue since {c.oldestDueDate}</span> : c.typeName}
                    </span>
                  </Link>
                  <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{rs(c.balance)}</span>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="btn-ghost shrink-0" aria-label={`Call ${c.name}`} title={c.phone}><Phone size={16} /></a>
                  )}
                  <button className="btn-ghost shrink-0 text-brand-700" aria-label={`Receive from ${c.name}`} title="Receive payment" onClick={() => { setPayFor(c.id); setModal('pay') }}>
                    <Wallet size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        <Card
          title={<span className="flex items-center gap-2"><AlertTriangle size={16} className="text-amber-500" /> Reorder soon {d.stock.low + d.stock.out > 0 && <Badge tone={d.stock.out ? 'red' : 'amber'}>{d.stock.low + d.stock.out}</Badge>}</span>}
          action={<Link to="/purchases/new" className="text-sm text-brand-700 hover:underline">Enter purchase</Link>}
        >
          {d.lowStock.length === 0 ? (
            <EmptyNote>All items are above their reorder level.</EmptyNote>
          ) : (
            <ul className="-mx-4 max-h-80 divide-y divide-stone-100 overflow-y-auto">
              {d.lowStock.map((p) => (
                <li key={p.id}>
                  <Link to={`/products/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-stone-50">
                    <span className="min-w-0 truncate">{p.label}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="hidden text-xs text-stone-400 sm:inline">min {p.reorderLevel}</span>
                      <Badge tone={p.onHand <= 0 ? 'red' : 'amber'}>{p.onHand <= 0 ? 'Out' : `${p.onHand} left`}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent sales" action={<Link to="/sales" className="text-sm text-brand-700 hover:underline">All sales</Link>}>
          {d.recent.length === 0 ? (
            <EmptyNote>No sales yet. <Link to="/sales/new" className="font-medium text-brand-700 hover:underline">Create the first invoice</Link></EmptyNote>
          ) : (
            <ul className="-mx-4 divide-y divide-stone-100">
              {d.recent.map((r) => (
                <li key={r.id}>
                  <Link to={`/sales/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-stone-50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.customerName}</span>
                      <span className="block text-xs text-stone-500">{r.invoiceNo} · {dayLabel(r.date)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-semibold tabular-nums">{rs(r.netTotal)} <ChevronRight size={14} className="text-stone-300" /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="This month by customer type">
            <Bars rows={d.byType.map((t) => ({ key: t.name, label: t.name, value: t.revenue }))} empty="No sales this month yet." />
          </Card>
          <Card title="Top products this month">
            <Bars rows={d.topProducts.map((t) => ({ key: String(t.productId), label: t.label, value: t.revenue, sub: `${t.qty} sold`, to: `/products/${t.productId}` }))} empty="No sales this month yet." />
          </Card>
        </div>
      </div>

      {d.payable > 0 && (
        <p className="text-sm text-stone-600">
          You owe suppliers <Link to="/suppliers" className="font-medium text-brand-700 hover:underline">Rs {rs(d.payable)}</Link>.
        </p>
      )}

      {modal === 'pay' && <PaymentModal partyType="customer" partyId={payFor} onClose={() => setModal(null)} />}
      {modal === 'adjust' && <AdjustModal onClose={() => setModal(null)} />}
      {modal === 'customer' && (
        <CustomerForm customer={{ id: 0, code: '', name: '', typeId: 0, phone: '', address: '', area: '', discPct: null, creditLimit: 0, creditDays: null, notes: '', active: true }} onClose={() => setModal(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- pieces

function change(now: number, before: number) {
  if (!before) return now > 0 ? null : undefined // no basis to compare
  return ((now - before) / before) * 100
}

function Chip({ to, tone, children }: { to: string; tone: 'red' | 'amber'; children: ReactNode }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition ${tone === 'red' ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}>
      {children} <ChevronRight size={12} />
    </Link>
  )
}

function Action({ to, onClick, icon: Icon, label, primary }: { to?: string; onClick?: () => void; icon: LucideIcon; label: string; primary?: boolean }) {
  const cls = `flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center text-xs font-medium transition sm:text-sm ${
    primary ? 'border-brand-700 bg-brand-700 text-white hover:bg-brand-800' : 'border-stone-200 bg-white text-stone-700 shadow-sm hover:border-brand-200 hover:bg-brand-50'
  }`
  const body = (
    <>
      <Icon size={20} className={primary ? '' : 'text-brand-700'} />
      <span className="leading-tight">{label}</span>
    </>
  )
  return to ? <Link to={to} className={cls}>{body}</Link> : <button onClick={onClick} className={cls}>{body}</button>
}

function Kpi({ to, icon: Icon, label, value, sub, trend, trendLabel, tone }: {
  to: string
  icon: LucideIcon
  label: string
  value: string
  sub: ReactNode
  trend?: number | null
  trendLabel?: string
  tone?: 'warn' | 'bad'
}) {
  return (
    <Link to={to} className="card block p-3 transition hover:border-brand-200 hover:shadow md:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium tracking-wide text-stone-500 uppercase md:text-xs">{label}</span>
        <Icon size={18} className="shrink-0 text-stone-400" />
      </div>
      <p className={`mt-1.5 truncate text-lg font-semibold tabular-nums md:text-2xl ${tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-stone-900'}`}>{value}</p>
      {trend !== undefined && (
        <p className="mt-1 flex items-center gap-1 text-xs">
          {trend === null ? (
            <span className="text-stone-400">no sales {trendLabel?.replace('vs ', '')} to compare</span>
          ) : (
            <>
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium ${trend >= 0 ? 'bg-brand-100 text-brand-800' : 'bg-red-100 text-red-700'}`}>
                {trend >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {Math.abs(trend).toFixed(0)}%
              </span>
              <span className="text-stone-500">{trendLabel}</span>
            </>
          )}
        </p>
      )}
      <p className="mt-1 truncate text-xs text-stone-500">{sub}</p>
    </Link>
  )
}

function Card({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <h2 className="font-semibold text-stone-900">{title}</h2>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-stone-500">{children}</p>
}

/** Horizontal magnitude bars — one hue, values labelled, no color-only meaning. */
function Bars({ rows, empty }: { rows: { key: string; label: string; value: number; sub?: string; to?: string }[]; empty: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value))
  if (!rows.length || max === 0) return <EmptyNote>{empty}</EmptyNote>
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const label = (
          <span className="min-w-0 truncate">
            {r.label}
            {r.sub && <span className="ml-1.5 text-xs text-stone-400">{r.sub}</span>}
          </span>
        )
        return (
          <div key={r.key} className="text-sm">
            <div className="flex justify-between gap-3">
              {r.to ? <Link to={r.to} className="min-w-0 truncate hover:underline">{label}</Link> : label}
              <span className="shrink-0 tabular-nums text-stone-700">Rs {rs(r.value)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-stone-100">
              <div className="h-2 rounded-full bg-brand-600" style={{ width: `${r.value ? Math.max((r.value / max) * 100, 2) : 0}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 30-day column chart with hover/tap tooltip. Single series → no legend; title names it. */
function SalesChart({ data }: { data: DashboardData['last30'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.revenue, 0)
  const days = data.filter((d) => d.revenue > 0).length
  const max = Math.max(...data.map((d) => d.revenue))
  const ticks = useMemo(() => {
    if (!max) return [0]
    const raw = max / 3
    const mag = 10 ** Math.floor(Math.log10(raw))
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
    return [0, step, step * 2, step * 3]
  }, [max])
  const top = ticks[ticks.length - 1] || 1
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null)
  const [W, setW] = useState(600)
  useEffect(() => {
    if (!wrap) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [wrap])
  const H = W < 500 ? 170 : 210
  const every = W < 500 ? 7 : 5
  const padL = 36
  const padB = 22
  const plotW = W - padL
  const plotH = H - padB - 6
  const slot = plotW / data.length
  const barW = Math.max(slot - 2, 2) // 2px surface gap between bars
  const y = (v: number) => 6 + plotH - (v / top) * plotH
  const h = hover != null ? data[hover] : null

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span><span className="text-lg font-semibold tabular-nums">Rs {rs(total)}</span> <span className="text-stone-500">total</span></span>
        <span className="text-stone-500">{days} selling day{days === 1 ? '' : 's'} · avg Rs {rs(days ? total / days : 0)} per day</span>
      </div>
      <div className="relative w-full min-w-0" ref={setWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} height={H} className="block w-full" role="img" aria-label={`Daily sales for the last 30 days, total Rs ${rs(total)}`} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="#e7e5e4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#78716c">{short(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padL + i * slot + 1
            const bh = d.revenue ? Math.max(plotH - (y(d.revenue) - 6), 2) : 0
            const r = Math.min(4, barW / 2, bh)
            const top = 6 + plotH - bh
            const isToday = i === data.length - 1
            return (
              <g key={d.date}>
                {bh > 0 && (
                  <path
                    d={`M${x},${6 + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${6 + plotH} Z`}
                    fill={hover === i ? '#1e472d' : isToday ? '#255a37' : '#3f8a57'}
                  />
                )}
                {/* bigger hit target than the bar */}
                <rect x={padL + i * slot} y={0} width={slot} height={H - padB} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                {(isToday || ((data.length - 1 - i) % every === 0 && data.length - 1 - i >= every)) && (
                  <text x={isToday ? x + barW : x + barW / 2} y={H - 6} textAnchor={isToday ? 'end' : 'middle'} fontSize="10" fill="#78716c">{isToday ? 'Today' : dayLabel(d.date)}</text>
                )}
              </g>
            )
          })}
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: `${Math.min(Math.max(((padL + (hover! + 0.5) * slot) / W) * 100, 12), 88)}%` }}
          >
            <p className="font-medium text-stone-900">{new Date(h.date + 'T00:00:00').toLocaleDateString('en-LK', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
            <p className="tabular-nums text-stone-700">Rs {rs(h.revenue)}</p>
            <p className="text-stone-500">{h.invoices} invoice{h.invoices === 1 ? '' : 's'}</p>
          </div>
        )}
        {total === 0 && <p className="absolute inset-0 flex items-center justify-center text-sm text-stone-500">No sales in the last 30 days yet</p>}
      </div>
    </div>
  )
}
