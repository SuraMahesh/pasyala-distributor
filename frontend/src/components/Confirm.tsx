import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal } from './ui'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  details?: ReactNode
  confirmText?: string
  cancelText?: string
  tone?: 'danger' | 'primary' | 'warning'
  /** just a notice — one button, no cancel */
  alertOnly?: boolean
}

type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>
const Ctx = createContext<ConfirmFn>(async () => window.confirm('Are you sure?'))

/** `const confirm = useConfirm(); if (await confirm({ title: 'Delete?' })) …` */
export const useConfirm = () => useContext(Ctx)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<(v: boolean) => void>(undefined)

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const close = (v: boolean) => {
    resolver.current?.(v)
    resolver.current = undefined
    setOpts(null)
  }

  const tone = opts?.tone ?? 'primary'
  const Icon = tone === 'danger' ? AlertTriangle : tone === 'warning' ? Info : CheckCircle2
  const iconCls = tone === 'danger' ? 'bg-red-100 text-red-600' : tone === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700'

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal
        open={!!opts}
        onClose={() => close(false)}
        title={opts?.title ?? ''}
        size="sm"
        footer={
          <>
            {!opts?.alertOnly && <button className="btn-secondary" onClick={() => close(false)}>{opts?.cancelText ?? 'Cancel'}</button>}
            <button
              autoFocus
              className={tone === 'danger' ? 'btn bg-red-600 text-white hover:bg-red-700' : 'btn-primary'}
              onClick={() => close(true)}
            >
              {opts?.confirmText ?? 'Confirm'}
            </button>
          </>
        }
      >
        <div className="flex gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconCls}`}>
            <Icon size={18} />
          </span>
          <div className="min-w-0 space-y-2 text-sm text-stone-700">
            {opts?.message && <div>{opts.message}</div>}
            {opts?.details && <div className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">{opts.details}</div>}
          </div>
        </div>
      </Modal>
    </Ctx.Provider>
  )
}
