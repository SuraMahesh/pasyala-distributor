import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Leaf, Loader2, LogIn } from 'lucide-react'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, setToken } from '../lib/api'

interface Me {
  required: boolean
  loggedIn: boolean
}

const LogoutCtx = createContext<{ required: boolean; logout: () => void }>({ required: false, logout: () => {} })
export const useLogout = () => useContext(LogoutCtx)

/** Shows the login screen until the API accepts our token. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api.get<Me>('/auth/me'), staleTime: Infinity, retry: 1 })

  useEffect(() => {
    const h = () => {
      setToken('')
      qc.setQueryData(['auth', 'me'], (m: Me | undefined) => ({ required: m?.required ?? true, loggedIn: false }))
    }
    window.addEventListener('pjd:logout', h)
    return () => window.removeEventListener('pjd:logout', h)
  }, [qc])

  // drop every cached screen except the login state itself
  const resetData = () => qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' })
  const logout = () => {
    setToken('')
    resetData()
    qc.setQueryData(['auth', 'me'], { required: true, loggedIn: false })
  }

  if (me.isLoading) {
    return <div className="flex min-h-dvh items-center justify-center text-stone-500"><Loader2 className="animate-spin" /></div>
  }
  if (me.error) {
    return (
      <Centered>
        <p className="font-medium text-red-700">Cannot reach the server</p>
        <p className="mt-1 text-sm text-stone-600">{(me.error as Error).message}</p>
        <button className="btn-primary mt-4 w-full" onClick={() => me.refetch()}>Try again</button>
      </Centered>
    )
  }
  if (me.data?.required && !me.data.loggedIn) {
    return <Login onDone={() => { resetData(); qc.setQueryData(['auth', 'me'], { required: true, loggedIn: true }) }} />
  }
  return <LogoutCtx.Provider value={{ required: !!me.data?.required, logout }}>{children}</LogoutCtx.Provider>
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-brand-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-saffron-400 text-brand-900"><Leaf size={22} /></span>
          <div className="leading-tight">
            <p className="font-semibold text-stone-900">Distribution ERP</p>
            <p className="text-xs text-stone-500">Ayurveda distribution ERP</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pw) return
    setBusy(true)
    setErr('')
    try {
      const { token } = await api.post<{ token: string }>('/auth/login', { password: pw })
      setToken(token)
      onDone()
    } catch (e2) {
      setErr(e2 instanceof ApiError && e2.status === 401 ? 'Wrong password' : (e2 as Error).message)
      setBusy(false)
    }
  }
  return (
    <Centered>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="label">Password</span>
          <input className="input" type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        {err && <p className="text-sm font-medium text-red-600">{err}</p>}
        <button className="btn-primary w-full" disabled={busy || !pw}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />} Log in
        </button>
      </form>
    </Centered>
  )
}
