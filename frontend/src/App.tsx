import { lazy, Suspense, type ComponentType } from 'react'
import { createBrowserRouter, Link, RouterProvider, useRouteError } from 'react-router-dom'
import Layout from './components/Layout'
import { Spinner } from './components/ui'

// each page is downloaded only when first opened (faster start on phones)
const page = <M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M = 'default') => {
  const C = lazy(() => load().then((m) => ({ default: m[name] as ComponentType })))
  return (
    <Suspense fallback={<Spinner />}>
      <C />
    </Suspense>
  )
}
const sales = () => import('./pages/Sales')
const purchases = () => import('./pages/Purchases')
const parties = () => import('./pages/Parties')
const products = () => import('./pages/Products')

function RouteError() {
  const err = useRouteError() as Error
  return (
    <div className="mx-auto max-w-lg p-8 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-stone-600">{err?.message ?? 'Unexpected error'}</p>
      <div className="mt-4 flex justify-center gap-2">
        <button className="btn-secondary" onClick={() => location.reload()}>Reload</button>
        <Link to="/" className="btn-primary">Dashboard</Link>
      </div>
    </div>
  )
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: page(() => import('./pages/Dashboard')) },
      { path: 'sales', element: page(sales, 'SalesList') },
      { path: 'sales/new', element: page(sales, 'SaleEdit') },
      { path: 'sales/:id', element: page(sales, 'SaleView') },
      { path: 'sales/:id/edit', element: page(sales, 'SaleEdit') },
      { path: 'purchases', element: page(purchases, 'PurchaseList') },
      { path: 'purchases/new', element: page(purchases, 'PurchaseEdit') },
      { path: 'purchases/:id', element: page(purchases, 'PurchaseView') },
      { path: 'purchases/:id/edit', element: page(purchases, 'PurchaseEdit') },
      { path: 'products', element: page(products) },
      { path: 'products/:id', element: page(products, 'ProductDetail') },
      { path: 'pricing', element: page(() => import('./pages/Pricing')) },
      { path: 'stock', element: page(() => import('./pages/Stock')) },
      { path: 'customers', element: page(parties, 'CustomerList') },
      { path: 'customers/:id', element: page(parties, 'CustomerDetail') },
      { path: 'suppliers', element: page(parties, 'SupplierList') },
      { path: 'suppliers/:id', element: page(parties, 'SupplierDetail') },
      { path: 'payments', element: page(() => import('./pages/Payments')) },
      { path: 'reports', element: page(() => import('./pages/Reports')) },
      { path: 'settings', element: page(() => import('./pages/Settings')) },
      { path: '*', element: <div className="p-8 text-center text-stone-600">Page not found. <Link className="text-brand-700 hover:underline" to="/">Go to dashboard</Link></div> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
