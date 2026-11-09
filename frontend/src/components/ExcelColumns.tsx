// Column picker shown before an Excel download: tick the columns that go into the file.
// The choice is remembered per table (localStorage) so the next download starts from it.
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { downloadExcel, type XCell, type XColumn } from '../lib/excel'
import { Modal } from './ui'

export interface ExportColumn<T> extends XColumn {
  key: string
  /** section heading in the picker; columns keep their definition order in the file */
  group?: string
  value: (row: T) => XCell
  /** summed in the bold TOTAL row */
  total?: boolean
}

export interface ExcelRequest<T> {
  title: string
  /** file name without the date and extension */
  fileBase: string
  sheet: string
  /** the rows, or a loader that fetches them when the download is confirmed */
  rows: T[] | (() => Promise<T[]>)
  /** what the loader will fetch, shown while the rows are not known yet */
  scope?: string
}

const CHECK = 'h-4 w-4 shrink-0 cursor-pointer accent-brand-700'

function saved(storageKey: string, columns: { key: string }[]): Set<string> {
  const all = new Set(columns.map((c) => c.key))
  try {
    const raw = localStorage.getItem(`excel-cols:${storageKey}`)
    if (raw) {
      const keys = (JSON.parse(raw) as unknown[]).filter((k): k is string => typeof k === 'string' && all.has(k))
      if (keys.length) return new Set(keys)
    }
  } catch { /* ignore */ }
  return all
}

/** builds the sheet for the ticked columns and downloads it */
function downloadColumns<T>(req: ExcelRequest<T>, columns: ExportColumn<T>[], rows: T[]) {
  const totals = columns.map((c, i) => (c.total ? i : -1)).filter((i) => i > 0)
  return downloadExcel(req.fileBase, [{
    name: req.sheet,
    columns: columns.map(({ header, type, width }) => ({ header, type, width })),
    rows: rows.map((r) => columns.map((c) => c.value(r))),
    totals,
  }])
}

export function ExcelColumnsModal<T>({ request, columns, storageKey, onClose }: {
  request: ExcelRequest<T>
  columns: ExportColumn<T>[]
  storageKey: string
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(() => saved(storageKey, columns))
  const [busy, setBusy] = useState(false)
  const chosen = columns.filter((c) => picked.has(c.key))
  const groups = [...new Set(columns.map((c) => c.group ?? ''))]
  const toggle = (key: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(key); else n.delete(key); return n })
  const setGroup = (g: string, on: boolean) => setPicked((p) => { const n = new Set(p); for (const c of columns) if ((c.group ?? '') === g) { if (on) n.add(c.key); else n.delete(c.key) } return n })
  const count = Array.isArray(request.rows) ? `${request.rows.length} row${request.rows.length === 1 ? '' : 's'}` : request.scope ?? 'every page of the current filter'

  const go = async () => {
    if (!chosen.length || busy) return
    setBusy(true)
    try {
      try { localStorage.setItem(`excel-cols:${storageKey}`, JSON.stringify(chosen.map((c) => c.key))) } catch { /* ignore */ }
      const rows = Array.isArray(request.rows) ? request.rows : await request.rows()
      await downloadColumns(request, chosen, rows)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={request.title}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={go} disabled={busy || !chosen.length}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />} Download Excel{chosen.length ? ` · ${chosen.length} column${chosen.length === 1 ? '' : 's'}` : ''}
          </button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-stone-600">
        <span>Tick the columns to put in the file · {count}</span>
        <span className="flex gap-3 text-xs">
          <button type="button" className="text-brand-700 hover:underline" onClick={() => setPicked(new Set(columns.map((c) => c.key)))}>All</button>
          <button type="button" className="text-brand-700 hover:underline" onClick={() => setPicked(new Set())}>None</button>
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((g) => {
          const cols = columns.filter((c) => (c.group ?? '') === g)
          const on = cols.filter((c) => picked.has(c.key)).length
          return (
            <fieldset key={g || '_'} className="rounded-lg border border-stone-200 p-3">
              {g && (
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input type="checkbox" className={CHECK} checked={on === cols.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < cols.length }} onChange={(e) => setGroup(g, e.target.checked)} aria-label={`All ${g} columns`} />
                    {g}
                  </label>
                </legend>
              )}
              <div className="grid gap-1.5">
                {cols.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2 text-sm text-stone-800">
                    <input type="checkbox" className={CHECK} checked={picked.has(c.key)} onChange={(e) => toggle(c.key, e.target.checked)} />
                    <span>{c.header}</span>
                    {c.total && <span className="text-xs text-stone-400">Σ</span>}
                  </label>
                ))}
              </div>
            </fieldset>
          )
        })}
      </div>
      {!chosen.length && <p className="mt-3 text-sm text-amber-700">Tick at least one column.</p>}
    </Modal>
  )
}
