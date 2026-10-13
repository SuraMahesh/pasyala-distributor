import { useQuery } from '@tanstack/react-query'
import { APP_VERSION } from '@pjd/shared'
import { AlertTriangle } from 'lucide-react'

/** Shows a banner when the API server is an older build than this screen (e.g. old server still running). */
export default function VersionWarning() {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await fetch('/api/health')).json() as Promise<{ version?: string }>,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
  if (!data || data.version === APP_VERSION) return null
  return (
    <div className="no-print mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">The server is an older version than this screen — some numbers will be wrong.</p>
        <p className="mt-0.5">
          On your computer: stop the running server (Ctrl + C), then run <code className="rounded bg-amber-100 px-1">npm install</code>,{' '}
          <code className="rounded bg-amber-100 px-1">npm run build</code> and <code className="rounded bg-amber-100 px-1">npm start</code> again.
          On Vercel: redeploy with all folders updated (frontend, backend, shared).
          <span className="ml-1 text-amber-700">(screen {APP_VERSION} · server {data.version ?? 'old'})</span>
        </p>
      </div>
    </div>
  )
}
