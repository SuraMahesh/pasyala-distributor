import { MessageSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Markdown } from '../components/Markdown'
import { Empty, ErrorBox, PageHeader } from '../components/ui'
import { toast } from 'sonner'
import { api, ApiError } from '../lib/api'

type Shown = { role: 'user' | 'assistant'; text: string }
type Req = { id: number; label: string; onHand: number; countedQty: number; delta: number; reason: string; notes: string; requestedBy: string; status: string; approver?: string }
type Status = { enabled: boolean; approvals: boolean; model: string }

/** One-tap questions — the same things the owner asks every day. */
const QUICK = [
  'How is business this month?',
  'Who owes us money?',
  'What should I reorder?',
  'Top selling products this month',
  'What is not selling?',
  'Anything I should worry about today?',
]

const NAME_KEY = 'pjd-assistant-name'
// the conversation is kept for this browser tab, so checking Stock and coming back does not lose it
const CHAT_KEY = 'pjd-assistant-chat'
const readChat = (): { shown: Shown[]; history: unknown[]; sig: string } => {
  try {
    const c = JSON.parse(sessionStorage.getItem(CHAT_KEY) ?? '')
    return { shown: c.shown ?? [], history: c.history ?? [], sig: c.sig ?? '' }
  } catch {
    return { shown: [], history: [], sig: '' }
  }
}
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
const saveName = (n: string) => {
  try {
    localStorage.setItem(NAME_KEY, n)
  } catch {
    /* private mode */
  }
}

export default function Assistant() {
  const [status, setStatus] = useState<Status | null>(null)
  const [name, setName] = useState(readName)
  const [history, setHistory] = useState<unknown[]>(() => readChat().history) // the model's conversation, sent back unchanged
  const [sig, setSig] = useState(() => readChat().sig) // server signature of `history` — proves it was not edited in the browser
  const [shown, setShown] = useState<Shown[]>(() => readChat().shown)
  const [statusError, setStatusError] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [requests, setRequests] = useState<Req[]>([])
  const endRef = useRef<HTMLDivElement>(null)

  const loadRequests = () => api.get<Req[]>('/assistant/requests?status=all').then(setRequests).catch(() => {})
  const loadStatus = () => api.get<Status>('/assistant/status').then((s) => { setStatus(s); setStatusError(false) }).catch(() => setStatusError(true))
  useEffect(() => {
    void loadStatus()
    void loadRequests()
    const t = setInterval(() => void loadRequests(), 60_000) // requests made from another phone show up by themselves
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify({ shown, history, sig }))
    } catch {
      /* ignore */
    }
  }, [shown, history, sig])
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [shown, busy])

  const send = async (question = text) => {
    const q = question.trim()
    if (!q || busy) return
    if (!name.trim()) {
      setError(new Error('Tell the assistant your name first (it is written on any stock request you make).'))
      return
    }
    saveName(name.trim())
    setBusy(true)
    setError(null)
    setShown((s) => [...s, { role: 'user', text: q }])
    setText('')
    try {
      const r = await api.post<{ reply: string; history: unknown[]; sig: string }>('/assistant/chat', { userName: name.trim(), text: q, history, sig })
      setHistory(r.history)
      setSig(r.sig)
      setShown((s) => [...s, { role: 'assistant', text: r.reply }])
      void loadRequests()
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && /out of date|too long/.test(e.message)) {
        setHistory([])
        setSig('')
      }
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const decide = async (id: number, action: 'approve' | 'reject') => {
    const approver = window.prompt(`Who is ${action === 'approve' ? 'approving' : 'rejecting'} request #${id}? (owner's name)`, name.trim())?.trim()
    if (!approver) return
    const pin = window.prompt(`Owner PIN to ${action} request #${id}`)
    if (!pin) return
    const note = action === 'reject' ? (window.prompt('Reason (optional)') ?? '') : ''
    setError(null)
    try {
      const r = await api.post<{ warning?: string } | null>(`/assistant/requests/${id}/${action}`, { approver, pin, note })
      toast.success(action === 'approve' ? `Request #${id} approved — stock adjusted` : `Request #${id} rejected`)
      if (r?.warning) toast.warning(r.warning, { duration: 8000 })
      void loadRequests()
    } catch (e) {
      setError(e)
    }
  }

  const ready = !!status?.enabled && !busy

  return (
    <div>
      <PageHeader
        title="Assistant"
        subtitle="Ask about stock, sales, customers and what they owe, suppliers, payments, prices and reports — in English or Sinhala. Only stock-count fixes change anything, and those need the owner's approval."
      />
      {statusError && <div className="mb-4"><ErrorBox title="Could not reach the server" error="The assistant's status could not be loaded." onRetry={() => void loadStatus()} /></div>}
      {status && !status.enabled && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          The assistant is switched off: set <code>ANTHROPIC_API_KEY</code> on the server.
        </p>
      )}
      <div className="mb-3 flex items-center gap-2">
        <label className="text-sm text-stone-600">Your name</label>
        <input className="input max-w-xs" placeholder="e.g. Suranga" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <button key={q} className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 transition hover:border-brand-500 hover:text-brand-800 disabled:opacity-50" disabled={!ready} onClick={() => void send(q)}>
            {q}
          </button>
        ))}
      </div>

      <div className="min-h-40 space-y-3 rounded-lg border bg-white p-3">
        {shown.length === 0 && (
          <Empty icon={<MessageSquare size={28} />}>
            <p>Tap a question above, or ask your own. For example:</p>
            <p className="text-stone-400">
              “How many 30ml Batu Thel do we have, and when did we last get it?” · “Which customers are overdue?” · “What did Asiri Pharmacy buy last month?”
              · “Show invoice PJD-000012” · “Sales by customer type this month” · “What is our stock worth?” · “Price of 750ml Pinda for a pharmacy”
            </p>
          </Empty>
        )}
        {shown.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] rounded-lg bg-brand-700 px-3 py-2 text-sm whitespace-pre-wrap text-white">{m.text}</div>
            ) : (
              <div className="max-w-full min-w-0 rounded-lg bg-stone-100 px-3 py-2 text-stone-900 sm:max-w-[95%]">
                <Markdown text={m.text} />
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-stone-500">Checking the ERP…</p>}
        <div ref={endRef} />
      </div>
      {error != null && <div className="mt-3"><ErrorBox title="Something went wrong" error={error} /></div>}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className="input flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
          placeholder="Ask about stock, a customer, an invoice, sales, payments…"
          disabled={!status?.enabled}
        />
        <div className="flex gap-2">
          <button className="btn-primary" disabled={!ready} onClick={() => void send()}>{busy ? '…' : 'Send'}</button>
          <button className="btn-secondary" onClick={() => { setHistory([]); setShown([]); setSig(''); setError(null) }}>New chat</button>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold">Pending stock requests</h2>
      {status && !status.approvals && <p className="text-sm text-stone-500">Approvals are off until <code>OWNER_PIN</code> is set on the server.</p>}
      {requests.filter((r) => r.status === 'pending').length === 0 ? (
        <p className="mt-1 text-sm text-stone-500">None.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {requests.filter((r) => r.status === 'pending').map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-white p-3 text-sm">
              <span className="font-medium">#{r.id} {r.label}</span>
              <span>{r.onHand} → {r.countedQty} <span className={r.delta < 0 ? 'text-red-700' : 'text-green-700'}>({r.delta > 0 ? '+' : ''}{r.delta})</span></span>
              <span className="text-stone-500">{r.reason} · {r.notes} · asked by {r.requestedBy}</span>
              <span className="ml-auto flex gap-2">
                <button className="btn-primary" disabled={!status?.approvals} onClick={() => void decide(r.id, 'approve')}>Approve</button>
                <button className="btn-secondary" disabled={!status?.approvals} onClick={() => void decide(r.id, 'reject')}>Reject</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {requests.some((r) => r.status !== 'pending') && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-stone-600">Decided requests ({requests.filter((r) => r.status !== 'pending').length})</summary>
          <ul className="mt-2 space-y-1">
            {requests.filter((r) => r.status !== 'pending').slice(0, 20).map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3 rounded-lg border bg-white p-2.5">
                <span className="font-medium">#{r.id} {r.label}</span>
                <span>{r.onHand} → {r.countedQty}</span>
                <span className={r.status === 'applied' ? 'text-green-700' : 'text-stone-500'}>{r.status}{r.approver ? ` by ${r.approver}` : ''}</span>
                <span className="text-stone-500">{r.notes}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
