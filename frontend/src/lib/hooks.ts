import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { Alert, CustomerType, Paged, PricingContext, Settings } from '@pjd/shared'
import { api, ApiError } from './api'

// ---------------------------------------------------------------- shared lookups

export interface ProductOption {
  id: number
  code: string
  name: string
  size: string
  active: boolean
  sellPrice: number
  listPrice: number
  supplierDiscPct: number
  onHand: number
  avgCost: number
}
export interface CustomerOption {
  id: number
  code: string
  name: string
  typeId: number
  typeName: string
  area: string
  discPct: number | null
  creditLimit: number
  balance: number
  overdue: number
  active: boolean
}
export interface SupplierOption {
  id: number
  code: string
  name: string
  balance: number
  active: boolean
  lastBillDiscPct: number | null
}

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings'), staleTime: 60_000 })
export const useProductOptions = () => useQuery({ queryKey: ['products', 'options'], queryFn: () => api.get<ProductOption[]>('/products/options') })
export const useCustomerOptions = () => useQuery({ queryKey: ['customers', 'options'], queryFn: () => api.get<CustomerOption[]>('/customers/options') })
export const useSupplierOptions = () => useQuery({ queryKey: ['suppliers', 'options'], queryFn: () => api.get<SupplierOption[]>('/suppliers/options') })
export const useCustomerTypes = () => useQuery({ queryKey: ['customer-types'], queryFn: () => api.get<CustomerType[]>('/customer-types') })
export const usePricingContext = () => useQuery({ queryKey: ['pricing', 'context'], queryFn: () => api.get<PricingContext>('/pricing/context') })
export const useAlerts = () => useQuery({ queryKey: ['alerts'], queryFn: () => api.get<Alert[]>('/alerts'), refetchInterval: 60_000 })

// ---------------------------------------------------------------- paged lists

/** List state kept in the URL so Back returns to the same page/filter. */
export function useListState<F extends Record<string, string>>(defaults: { pageSize?: number; sort?: string; dir?: 'asc' | 'desc' } & F) {
  const [params, setParams] = useSearchParams()
  const get = (k: string, d: string) => params.get(k) ?? d
  const state = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(defaults)) out[k] = get(k, String(v ?? ''))
    return {
      ...(out as unknown as F),
      page: Number(get('page', '1')) || 1,
      pageSize: Number(get('pageSize', String(defaults.pageSize ?? 25))) || 25,
      search: get('search', ''),
      sort: get('sort', defaults.sort ?? ''),
      dir: (get('dir', defaults.dir ?? 'asc') as 'asc' | 'desc'),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])
  const set = useCallback(
    (patch: Record<string, string | number | undefined>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '' || String(v) === String((defaults as Record<string, unknown>)[k] ?? '')) next.delete(k)
            else next.set(k, String(v))
          }
          if (resetPage && !('page' in patch)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setParams],
  )
  return [state, set] as const
}

export function usePaged<T, S = Record<string, number>>(key: string, path: string, params: Record<string, string | number | undefined>) {
  return useQuery({
    queryKey: [key, 'list', params],
    queryFn: () => api.get<Paged<T> & { summary: S }>(path, params),
    placeholderData: keepPreviousData,
  })
}

// ---------------------------------------------------------------- mutations with toasts

export function errorMessage(e: unknown) {
  return e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong'
}

/**
 * Runs a write, shows a toast on success/failure and refreshes every cached list
 * (stock, balances and dues all depend on each other, so refresh everything).
 */
export function useApiMutation<TVars, TRes = unknown>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes, v: TVars) => string); onSuccess?: (r: TRes, v: TVars) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      await qc.invalidateQueries()
      const msg = typeof opts.success === 'function' ? opts.success(r, v) : opts.success
      if (msg) toast.success(msg)
      const warnings = (r as { warnings?: string[] } | null)?.warnings
      warnings?.forEach((w) => toast.warning(w, { duration: 8000 }))
      opts.onSuccess?.(r, v)
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(errorMessage(e), { duration: 8000 })
    },
  })
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = () => setM(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}
