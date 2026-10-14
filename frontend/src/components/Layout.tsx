import {
  BarChart3,
  Boxes,
  FileInput,
  FileOutput,
  Images,
  LayoutDashboard,
  Leaf,
  LogOut,
  Menu,
  Package,
  Plus,
  Settings,
  Tags,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSettings } from '../lib/hooks'
import { useLogout } from './AuthGate'
import { useConfirm } from './Confirm'
import NotificationBell from './NotificationBell'
import VersionWarning from './VersionWarning'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/sales', label: 'Sales Invoices', icon: FileOutput },
  { to: '/customers', label: 'Shops & Customers', icon: Users },
  { to: '/pricing', label: 'Prices & Discounts', icon: Tags },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/stock', label: 'Stock', icon: Boxes },
  { to: '/purchases', label: 'Purchases (GRN)', icon: FileInput },
  { to: '/suppliers', label: 'Suppliers', icon: Truck },
  { to: '/payments', label: 'Payments', icon: Wallet },
  { to: '/photos', label: 'Invoice photos', icon: Images },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const BOTTOM = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/sales', label: 'Sales', icon: FileOutput },
  { to: '/sales/new', label: 'New sale', icon: Plus, primary: true },
  { to: '/stock', label: 'Stock', icon: Boxes },
  { to: '/customers', label: 'Shops', icon: Users },
]

export default function Layout() {
  const [open, setOpen] = useState(false)
  const { data: settings } = useSettings()
  const company = settings?.name ?? 'Pasyala Janith Distributor'
  const loc = useLocation()
  const auth = useLogout()
  const confirm = useConfirm()
  const askLogout = async () => {
    if (await confirm({ title: 'Log out?', message: 'You will need the password to open the system again on this device.', confirmText: 'Log out' })) auth.logout()
  }
  useEffect(() => setOpen(false), [loc.pathname])

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition lg:py-2 ${
              isActive ? 'bg-brand-700 text-white' : 'text-brand-100 hover:bg-brand-800 hover:text-white'
            }`
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  )

  const brand = (
    <Link to="/" className="flex items-center gap-2.5 px-5 py-5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-saffron-400 text-brand-900">
        <Leaf size={20} />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-semibold text-white">{company}</p>
        <p className="text-[11px] text-brand-200">Ayurveda distribution ERP</p>
      </div>
    </Link>
  )

  return (
    <div className="flex min-h-dvh">
      {/* desktop sidebar */}
      <aside className="no-print sticky top-0 z-40 hidden h-dvh w-60 shrink-0 flex-col bg-brand-900 lg:flex">
        {brand}
        <div className="px-3"><NotificationBell variant="sidebar" /></div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <Link to="/sales/new" className="m-3 mb-1 btn bg-saffron-400 font-semibold text-brand-900 hover:bg-saffron-500">
          <Plus size={16} /> New sale
        </Link>
        {auth.required && <LogoutButton onClick={askLogout} />}
      </aside>

      {/* mobile / tablet drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-stone-900/40" />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-brand-900 pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button className="rounded-lg p-2 text-brand-100 hover:bg-brand-800" onClick={() => setOpen(false)} aria-label="Close menu"><X size={20} /></button>
            </div>
            {nav}
            {auth.required && <div className="mt-auto px-3 pb-4"><LogoutButton onClick={askLogout} /></div>}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-2 border-b border-stone-200 bg-white/95 px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur lg:hidden">
          <button className="rounded-lg p-2 text-stone-600 hover:bg-stone-100" onClick={() => setOpen(true)} aria-label="Menu">
            <Menu size={22} />
          </button>
          <Link to="/" className="min-w-0 flex-1 truncate font-semibold text-brand-800">{company}</Link>
          <NotificationBell />
        </header>
        <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-x-clip px-4 pt-4 pb-24 md:px-6 md:pt-6 lg:pb-8">
          <VersionWarning />
          <Outlet />
        </main>
      </div>

      {/* phone bottom bar */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {BOTTOM.map(({ to, label, icon: Icon, end, primary }) => (
          <NavLink
            key={to}
            to={to}
            end={end || primary}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${primary ? 'text-brand-800' : isActive ? 'text-brand-700' : 'text-stone-500'}`
            }
          >
            {primary ? (
              <span className="-mt-5 flex h-11 w-11 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg ring-4 ring-white"><Icon size={22} /></span>
            ) : (
              <Icon size={20} />
            )}
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function LogoutButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mx-3 mb-3 flex w-[calc(100%-1.5rem)] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-brand-200 hover:bg-brand-800 hover:text-white">
      <LogOut size={18} /> Log out
    </button>
  )
}
