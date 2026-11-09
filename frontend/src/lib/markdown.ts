// The assistant's replies are markdown: pipe tables, headings, bullet / numbered lists, **bold** and `code`.
// `parseMarkdown` turns a reply into blocks the Markdown component renders and the report downloads read.
import type { XCell, XSheet } from './excel'

export type Block =
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'para'; lines: string[] }

const HEADING = /^\s*(#{1,6})\s+(.*)$/
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/
const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isSeparator = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (isRow(line) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]))
      out.push({ type: 'table', header, rows })
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      out.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }
    if (BULLET.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: string[] = []
      while (i < lines.length && BULLET.test(lines[i])) items.push(lines[i++].replace(BULLET, ''))
      out.push({ type: 'list', ordered, items })
      continue
    }
    const para: string[] = []
    do para.push(lines[i++])
    while (i < lines.length && lines[i].trim() && !isRow(lines[i]) && !BULLET.test(lines[i]) && !HEADING.test(lines[i]))
    out.push({ type: 'para', lines: para })
  }
  return out
}

/** Right-align a column when every filled cell is a number / amount / percentage. */
export function isNumericColumn(rows: string[][], k: number) {
  const vals = rows.map((r) => r[k] ?? '').filter(Boolean)
  return vals.length > 0 && vals.every((v) => /\d/.test(v) && /^[\s\d.,+\-%()*]*(Rs\.?)?[\s\d.,+\-%()*]*$/.test(v))
}

/** the text without its **bold** and `code` marks */
export const plain = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim()

// ---------------------------------------------------------------- Excel

type Kind = 'money' | 'pct' | 'int' | 'dec' | 'text'
/** a line that is only **bold text** — the assistant's way of titling the table under it */
const BOLD_LINE = /^\s*\*\*[^*]+\*\*:?\s*$/

/** "Rs 12,450.00" → 12450 (money) · "12.5%" → 12.5 (pct) · "(1,200)" → -1200 · anything else stays text */
function toCell(raw: string): { v: XCell; kind: Kind } {
  const s = plain(raw)
  if (!s || s === '—' || s === '-') return { v: '', kind: 'text' }
  const m = s.match(/^(Rs\.?\s*)?([+-]?\(?[\d,]+(?:\.\d+)?\)?)\s*(%)?$/i)
  if (!m) return { v: s, kind: 'text' }
  const neg = /^\(.*\)$/.test(m[2]) || m[2].startsWith('-')
  const n = Math.abs(parseFloat(m[2].replace(/[,()+-]/g, '')))
  if (!Number.isFinite(n)) return { v: s, kind: 'text' }
  return { v: neg ? -n : n, kind: m[1] ? 'money' : m[3] ? 'pct' : /\.\d/.test(m[2]) ? 'dec' : 'int' }
}

/** One sheet per table in the reply. The sheet is named after the heading (or bold line) just above the table. */
export function tableSheets(blocks: Block[], fallback = 'Table'): XSheet[] {
  const sheets: XSheet[] = []
  const used = new Set<string>()
  let title = ''
  for (const b of blocks) {
    if (b.type === 'heading') title = plain(b.text)
    else if (b.type === 'para' && b.lines.length === 1 && BOLD_LINE.test(b.lines[0])) title = plain(b.lines[0]).replace(/:$/, '')
    else if (b.type === 'table') {
      const cols = b.header.map((h, k) => {
        const kinds = b.rows.map((r) => toCell(r[k] ?? '')).filter((c) => c.kind !== 'text' && c.v !== '').map((c) => c.kind)
        const type = kinds.length && kinds.every((x) => x === 'money') ? 'money'
          : kinds.length && kinds.every((x) => x === 'pct') ? 'pct'
          : kinds.length && kinds.every((x) => x === 'int') ? 'int'
          : kinds.length ? 'money' : 'text'
        return { header: plain(h) || `Column ${k + 1}`, type: type as XSheet['columns'][number]['type'] }
      })
      let name = title || `${fallback} ${sheets.length + 1}`
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${title || fallback} ${n}`
      used.add(name.toLowerCase())
      sheets.push({ name, columns: cols, rows: b.rows.map((r) => b.header.map((_, k) => toCell(r[k] ?? '').v)) })
      title = ''
    } else title = ''
  }
  return sheets
}

/** The reply's text (everything but the tables) as a two-column sheet, headed by the question. */
export function textSheet(blocks: Block[], meta: [string, string][], tables: XSheet[]): XSheet {
  const rows: XCell[][] = meta.map(([k, v]) => [k, v])
  rows.push(['', ''])
  let t = 0
  for (const b of blocks) {
    if (b.type === 'heading') rows.push([plain(b.text), ''])
    else if (b.type === 'para' && b.lines.length === 1 && BOLD_LINE.test(b.lines[0])) rows.push([plain(b.lines[0]).replace(/:$/, ''), ''])
    else if (b.type === 'para') for (const l of b.lines) rows.push(['', plain(l)])
    else if (b.type === 'list') b.items.forEach((it, k) => rows.push([b.ordered ? `${k + 1}.` : '•', plain(it)]))
    else rows.push(['Table', tables[t] ? `see sheet "${tables[t++].name}"` : ''])
  }
  return { name: 'Report', columns: [{ header: 'Assistant report', width: 18 }, { header: 'Detail', width: 90 }], rows }
}
