import { Fragment, type ReactNode } from 'react'
import { isNumericColumn, parseMarkdown } from '../lib/markdown'

/**
 * Tiny renderer for the assistant's replies: pipe tables, headings, bullet / numbered lists, **bold** and `code`.
 * Builds React elements only (no HTML injection). Anything it does not recognise is shown as plain text.
 */
export function Markdown({ text }: { text: string }) {
  const out = parseMarkdown(text).map((b, i) => {
    if (b.type === 'table') {
      const right = b.header.map((_, k) => isNumericColumn(b.rows, k))
      return (
        <div key={i} className="my-2 overflow-x-auto">
          <table className="table text-xs md:text-sm">
            <thead>
              <tr>{b.header.map((h, k) => <th key={k} className={right[k] ? 'text-right' : ''}>{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>{b.header.map((_, k) => <td key={k} className={right[k] ? 'text-right tabular-nums whitespace-nowrap' : ''}>{inline(r[k] ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    if (b.type === 'heading') return <p key={i} className="mt-2 font-semibold">{inline(b.text)}</p>
    if (b.type === 'list') {
      const Tag = b.ordered ? 'ol' : 'ul'
      return (
        <Tag key={i} className={`my-1 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
          {b.items.map((it, k) => <li key={k}>{inline(it)}</li>)}
        </Tag>
      )
    }
    return (
      <p key={i} className="my-1">
        {b.lines.map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l)}</Fragment>)}
      </p>
    )
  })
  return <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{out}</div>
}

/** **bold** and `code`; everything else is text. */
function inline(s: string): ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, k) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={k}>{p.slice(2, -2)}</strong>
    : p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={k} className="rounded bg-stone-200/70 px-1 text-[0.9em]">{p.slice(1, -1)}</code>
    : <Fragment key={k}>{p}</Fragment>,
  )
}
