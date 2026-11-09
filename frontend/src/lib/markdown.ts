// The assistant's replies are markdown: pipe tables, headings, bullet / numbered lists, **bold** and `code`.
// `parseMarkdown` turns a reply into blocks the Markdown component renders and the report downloads read.
import type { XCell, XSheet } from './excel'

export type Block =
  | { type: 'table'; header: string[]; rows: string[][]; title?: string }
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

export type Kind = 'money' | 'pct' | 'int' | 'dec' | 'text'
/** a line that is only **bold text** — the assistant's way of titling the table under it */
const BOLD_LINE = /^\s*\*\*[^*]+\*\*:?\s*$/
const TOTAL_ROW = /^(grand\s+)?total\b|^sum\b|^මුළු|^එකතුව/i

/** A heading or bold line right above a table becomes the table's title (the sheet name, the section heading). */
export function withTitles(blocks: Block[]): Block[] {
  const out: Block[] = []
  for (const b of blocks) {
    const prev = out[out.length - 1]
    if (b.type === 'table' && prev) {
      const title = prev.type === 'heading' ? plain(prev.text)
        : prev.type === 'para' && prev.lines.length === 1 && BOLD_LINE.test(prev.lines[0]) ? plain(prev.lines[0]).replace(/:$/, '')
        : ''
      if (title) {
        out.pop()
        out.push({ ...b, title })
        continue
      }
    }
    out.push(b)
  }
  return out
}

export interface TableInfo {
  /** what the filled cells of each column are: money / pct / int / dec, or text */
  kinds: Kind[]
  /** the body rows (the assistant's own Total row, if any, is left out) */
  body: string[][]
  /** the assistant's own Total row, when the table ends with one */
  totalRow: string[] | null
  /** column sums for the numeric, non-percentage columns (null elsewhere) */
  totals: (number | null)[]
  /** the measure to chart and headline: the first money column, else decimal, int, pct; -1 when there is none */
  keyCol: number
  /** the first text column — the labels of the chart */
  labelCol: number
}

export function analyseTable(t: { header: string[]; rows: string[][] }): TableInfo {
  const last = t.rows[t.rows.length - 1]
  const totalRow = last && TOTAL_ROW.test(plain(last.find((c) => plain(c)) ?? '')) ? last : null
  const body = totalRow ? t.rows.slice(0, -1) : t.rows
  // a column counts as numeric only when every filled cell is a number: "195 (180 + 15 free)" keeps its column as text
  const kinds: Kind[] = t.header.map((_, k) => {
    const ks = body.map((r) => cellValue(r[k] ?? '')).filter((c) => c.v !== '').map((c) => c.kind)
    if (!ks.length || ks.includes('text')) return 'text'
    if (ks.every((x) => x === 'money')) return 'money'
    if (ks.every((x) => x === 'pct')) return 'pct'
    if (ks.every((x) => x === 'int')) return 'int'
    return 'dec'
  })
  const totals = kinds.map((kind, k) => (kind === 'text' || kind === 'pct' ? null : body.reduce((a, r) => { const c = cellValue(r[k] ?? ''); return a + (typeof c.v === 'number' ? c.v : 0) }, 0)))
  const pick = (want: Kind) => kinds.findIndex((kind, k) => kind === want && k > 0)
  const keyCol = [pick('money'), pick('dec'), pick('int'), pick('pct')].find((k) => k >= 0) ?? -1
  return { kinds, body, totalRow, totals, keyCol, labelCol: kinds.indexOf('text') }
}

/** "Rs 12,450.00" → 12450 (money) · "12.5%" → 12.5 (pct) · "(1,200)" → -1200 · anything else stays text */
export function cellValue(raw: string): { v: XCell; kind: Kind } {
  const s = plain(raw)
  if (!s || s === '—' || s === '-') return { v: '', kind: 'text' }
  const m = s.match(/^(Rs\.?\s*)?([+-]?\(?[\d,]+(?:\.\d+)?\)?)\s*(%)?$/i)
  if (!m) return { v: s, kind: 'text' }
  const neg = /^\(.*\)$/.test(m[2]) || m[2].startsWith('-')
  const n = Math.abs(parseFloat(m[2].replace(/[,()+-]/g, '')))
  if (!Number.isFinite(n)) return { v: s, kind: 'text' }
  return { v: neg ? -n : n, kind: m[1] ? 'money' : m[3] ? 'pct' : /\.\d/.test(m[2]) ? 'dec' : 'int' }
}

/** One sheet per table in the reply, named after the table's title (see withTitles). A TOTAL row is added unless the assistant wrote one. */
export function tableSheets(blocks: Block[], fallback = 'Table'): XSheet[] {
  const sheets: XSheet[] = []
  const used = new Set<string>()
  for (const b of blocks) {
    if (b.type !== 'table') continue
    const info = analyseTable(b)
    const cols = b.header.map((h, k) => ({ header: plain(h) || `Column ${k + 1}`, type: (info.kinds[k] === 'dec' ? 'money' : info.kinds[k]) as XSheet['columns'][number]['type'] }))
    let name = b.title || `${fallback} ${sheets.length + 1}`
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${b.title || fallback} ${n}`
    used.add(name.toLowerCase())
    const totals = info.totalRow ? [] : info.totals.map((t, k) => (t === null || k === 0 ? -1 : k)).filter((k) => k > 0)
    sheets.push({ name, columns: cols, rows: b.rows.map((r) => b.header.map((_, k) => cellValue(r[k] ?? '').v)), totals })
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
    else rows.push([b.title || 'Table', tables[t] ? `see sheet "${tables[t++].name}"` : ''])
  }
  return { name: 'Report', columns: [{ header: 'Assistant report', width: 18 }, { header: 'Detail', width: 90 }], rows }
}

/** "Report: sales by customer this month" → "Sales by customer this month"; any other question is used as it is */
export function reportTitle(question: string, fallback = 'Assistant report') {
  const q = question.trim().replace(/\s+/g, ' ')
  if (!q) return fallback
  const m = q.match(/^(?:(?:please|can you|could you)\s+)?(?:(?:make|generate|create|give|show|prepare)\s+(?:me\s+)?(?:a\s+)?)?report\s*(?:of|on|for|about|:|-)?\s*(.+)$/i)
  const t = (m ? m[1] : q).replace(/[?.!]+$/, '').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : fallback
}
