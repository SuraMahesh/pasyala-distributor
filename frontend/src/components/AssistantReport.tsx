// An assistant reply laid out as a report: business header, question, headline figures, each table with a total row
// and a bar chart of its key measure, then the notes. Shown in the report window and printed / saved as PDF as it is.
import { Fragment, type CSSProperties, type ReactNode } from 'react'
import { qtyFmt, rs, type Settings } from '@pjd/shared'
import { analyseTable, cellValue, isNumericColumn, parseMarkdown, plain, reportTitle, withTitles, type Block, type Kind } from '../lib/markdown'

const INK: CSSProperties = { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }

const fmt = (n: number, kind: Kind) => (kind === 'money' ? `Rs ${rs(n)}` : kind === 'int' ? qtyFmt(n) : kind === 'pct' ? `${rs(n)}%` : rs(n))

/** **bold** and `code` inside a line */
function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, k) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={k}>{p.slice(2, -2)}</strong>
    : p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={k} className="rounded bg-stone-100 px-1 text-[0.9em]">{p.slice(1, -1)}</code>
    : <Fragment key={k}>{p}</Fragment>,
  )
}

type Table = Extract<Block, { type: 'table' }>

function ReportTable({ n, t }: { n: number; t: Table }) {
  const info = analyseTable(t)
  const right = t.header.map((_, k) => info.kinds[k] !== 'text' || isNumericColumn(info.body, k))
  const total = info.totalRow ?? (info.totals.some((x) => x !== null) ? t.header.map((_, k) => (k === 0 ? 'Total' : info.totals[k] === null ? '' : fmt(info.totals[k]!, info.kinds[k]))) : null)
  // chart: the key measure per label, the biggest 12 bars when the table is longer
  const chart = (() => {
    if (info.keyCol < 0 || info.labelCol < 0 || info.body.length < 2) return null
    const pts = info.body
      .map((r) => ({ label: plain(r[info.labelCol] ?? ''), text: plain(r[info.keyCol] ?? ''), v: cellValue(r[info.keyCol] ?? '').v }))
      .filter((p): p is { label: string; text: string; v: number } => typeof p.v === 'number')
    if (pts.length < 2) return null
    const top = pts.length > 12 ? [...pts].sort((a, b) => b.v - a.v).slice(0, 12) : pts
    const max = Math.max(...top.map((p) => Math.abs(p.v)), 0)
    if (!max) return null
    return { top, max, more: pts.length - top.length }
  })()
  return (
    <section className="mt-5 break-inside-avoid-page">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-300 pb-1">
        <h3 className="font-semibold text-stone-900">{n}. {t.title || `Table ${n}`}</h3>
        <span className="text-xs text-stone-500">{info.body.length} row{info.body.length === 1 ? '' : 's'}{info.keyCol >= 0 && info.totals[info.keyCol] !== null ? ` · ${plain(t.header[info.keyCol])} ${fmt(info.totals[info.keyCol]!, info.kinds[info.keyCol])}` : ''}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="table mt-1 text-[inherit]">
          <thead>
            <tr>{t.header.map((h, k) => <th key={k} className={right[k] ? 'text-right' : ''}>{plain(h)}</th>)}</tr>
          </thead>
          <tbody>
            {info.body.map((r, ri) => (
              <tr key={ri} className={ri % 2 ? 'bg-stone-50/70' : ''} style={INK}>
                {t.header.map((_, k) => <td key={k} className={right[k] ? 'text-right tabular-nums whitespace-nowrap' : ''}>{inline(r[k] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot>
              <tr className="border-t-2 border-stone-400 font-semibold" style={INK}>
                {t.header.map((_, k) => <td key={k} className={`${right[k] ? 'text-right tabular-nums whitespace-nowrap' : ''} border-b-0 pt-2`}>{inline(total[k] ?? '')}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {chart && (
        <figure className="mt-3 break-inside-avoid">
          <figcaption className="text-xs text-stone-500">{plain(t.header[info.keyCol])} by {plain(t.header[info.labelCol])}{chart.more > 0 ? ` · top ${chart.top.length} of ${chart.top.length + chart.more}` : ''}</figcaption>
          <div className="mt-1 grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-x-2 gap-y-1 text-xs">
            {chart.top.map((p, k) => (
              <Fragment key={k}>
                <span className="truncate text-stone-700" title={p.label}>{p.label}</span>
                <span className="h-3.5 rounded-sm bg-stone-100" style={INK}>
                  <span className="block h-full rounded-sm bg-brand-600" style={{ ...INK, width: `${Math.max(0, (Math.abs(p.v) / chart.max) * 100)}%`, opacity: p.v < 0 ? 0.45 : 1 }} />
                </span>
                <span className="tabular-nums text-stone-700">{p.text}</span>
              </Fragment>
            ))}
          </div>
        </figure>
      )}
    </section>
  )
}

export default function AssistantReport({ settings, question, reply, askedBy, date }: {
  settings?: Settings
  question: string
  reply: string
  askedBy: string
  date: string
}) {
  const blocks = withTitles(parseMarkdown(reply))
  const tables = blocks.filter((b): b is Table => b.type === 'table')
  // headline figures: one tile per table, the total of its key measure
  const tiles = tables.slice(0, 4).map((t, i) => {
    const info = analyseTable(t)
    const k = info.keyCol
    const fromRow = k >= 0 && info.totalRow ? cellValue(info.totalRow[k] ?? '').v : null
    const value = typeof fromRow === 'number' ? fromRow : k >= 0 ? info.totals[k] : null
    return { title: t.title || `Table ${i + 1}`, label: k >= 0 ? plain(t.header[k]) : 'Rows', value: value !== null && k >= 0 ? fmt(value, info.kinds[k]) : String(info.body.length), rows: info.body.length }
  })
  let n = 0
  return (
    <div className="print-area card mx-auto max-w-4xl bg-white p-4 text-[12px] text-stone-900 sm:p-6 sm:text-[13px] md:p-10">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-brand-700 pb-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight sm:text-xl">{settings?.name ?? 'Pasyala Janith Distributor'}</h2>
          {settings?.address && <p className="text-stone-600">{settings.address}</p>}
          {settings && <p className="text-stone-600">{[settings.phone && `Tel: ${settings.phone}`, settings.email && `Email: ${settings.email}`].filter(Boolean).join(' · ')}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold tracking-[0.2em] text-brand-700">ASSISTANT REPORT</p>
          <p className="text-base font-bold">{reportTitle(question)}</p>
          <p className="text-stone-600">{date}{askedBy ? ` · ${askedBy}` : ''}</p>
        </div>
      </header>
      {question && <p className="mt-3 text-stone-600"><span className="font-semibold text-stone-800">Question:</span> {question}</p>}
      {tiles.length > 0 && (
        <div className={`mt-4 grid gap-3 ${tiles.length === 1 ? 'sm:grid-cols-2' : tiles.length === 2 ? 'sm:grid-cols-2' : tiles.length === 3 ? 'sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {tiles.map((t, i) => (
            <div key={i} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2" style={INK}>
              <p className="truncate text-[11px] font-medium uppercase tracking-wide text-stone-500" title={t.title}>{t.title}</p>
              <p className="text-base font-bold tabular-nums text-stone-900">{t.value}</p>
              <p className="text-[11px] text-stone-500">{t.label}{t.label !== 'Rows' ? ` · ${t.rows} rows` : ''}</p>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 leading-relaxed">
        {blocks.map((b, i) => {
          if (b.type === 'table') return <ReportTable key={i} n={++n} t={b} />
          if (b.type === 'heading') return <h3 key={i} className="mt-4 font-semibold text-stone-900">{inline(b.text)}</h3>
          if (b.type === 'list') {
            const Tag = b.ordered ? 'ol' : 'ul'
            return (
              <Tag key={i} className={`my-2 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
                {b.items.map((it, k) => <li key={k}>{inline(it)}</li>)}
              </Tag>
            )
          }
          return (
            <p key={i} className="my-2">
              {b.lines.map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l)}</Fragment>)}
            </p>
          )
        })}
      </div>
      <p className="mt-6 border-t border-stone-200 pt-2 text-[11px] text-stone-500">
        Figures as recorded in the ERP when the question was asked · Generated by the ERP assistant · {date}
      </p>
    </div>
  )
}
