import { Fragment, type ReactNode } from 'react'

/**
 * Tiny renderer for the assistant's replies: pipe tables, headings, bullet / numbered lists, **bold** and `code`.
 * Builds React elements only (no HTML injection). Anything it does not recognise is shown as plain text.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    // table: header row, separator row, body rows
    if (isRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = cells(line)
      i += 2
      const body: string[][] = []
      while (i < lines.length && isRow(lines[i])) body.push(cells(lines[i++]))
      const right = header.map((_, k) => isNumericColumn(body, k))
      out.push(
        <div key={out.length} className="my-2 overflow-x-auto">
          <table className="table text-xs md:text-sm">
            <thead>
              <tr>{header.map((h, k) => <th key={k} className={right[k] ? 'text-right' : ''}>{inline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{header.map((_, k) => <td key={k} className={right[k] ? 'text-right tabular-nums whitespace-nowrap' : ''}>{inline(r[k] ?? '')}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      out.push(<p key={out.length} className="mt-2 font-semibold">{inline(heading[2])}</p>)
      i++
      continue
    }
    if (BULLET.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && BULLET.test(lines[i])) items.push(lines[i++].replace(BULLET, ''))
      const Tag = ordered ? 'ol' : 'ul'
      out.push(
        <Tag key={out.length} className={`my-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((it, k) => <li key={k}>{inline(it)}</li>)}
        </Tag>,
      )
      continue
    }
    // paragraph: consecutive plain lines (always consumes at least one line)
    const para: string[] = []
    do para.push(lines[i++])
    while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !BULLET.test(lines[i]) && !HEADING.test(lines[i]))
    out.push(
      <p key={out.length} className="my-1">
        {para.map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l)}</Fragment>)}
      </p>,
    )
  }
  return <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{out}</div>
}

const HEADING = /^\s*(#{1,6})\s+(.*)$/
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/
const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isSeparator = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

/** Right-align a column when every filled cell is a number / amount / percentage. */
function isNumericColumn(body: string[][], k: number) {
  const vals = body.map((r) => r[k] ?? '').filter(Boolean)
  return vals.length > 0 && vals.every((v) => /\d/.test(v) && /^[\s\d.,+\-%()*]*(Rs\.?)?[\s\d.,+\-%()*]*$/.test(v))
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
