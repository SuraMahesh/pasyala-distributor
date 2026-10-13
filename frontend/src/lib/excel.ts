// Excel (.xlsx) downloads. The writer library is loaded only when a download is clicked.
import { toast } from 'sonner'
import { todayLK } from '@pjd/shared'

export type XCell = string | number | boolean | null | undefined

export interface XColumn {
  header: string
  /** 'money' → 1,234.56 · 'int' → 1,234 · 'pct' → 12.5% (value given as 12.5) */
  type?: 'text' | 'money' | 'int' | 'pct' | 'date'
  width?: number
}

export interface XSheet {
  name: string
  columns: XColumn[]
  rows: XCell[][]
  /** adds a bold TOTAL row summing these column indexes */
  totals?: number[]
}

const FORMATS = { money: '#,##0.00', int: '#,##0', pct: '0.0"%"' } as const

const safeSheetName = (n: string) => n.replace(/\s*[[\]:*?/\\]+\s*/g, '-').replace(/\s+/g, ' ').slice(0, 31) || 'Sheet1'

function cell(v: XCell, col: XColumn) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    const fmt = col.type && col.type in FORMATS ? FORMATS[col.type as keyof typeof FORMATS] : undefined
    return { value: v, type: Number, ...(fmt ? { format: fmt } : {}) }
  }
  if (typeof v === 'boolean') return { value: v ? 'Yes' : 'No', type: String }
  return { value: String(v), type: String }
}

function width(col: XColumn, rows: XCell[][], i: number) {
  if (col.width) return col.width
  const longest = rows.slice(0, 300).reduce((m, r) => Math.max(m, String(r[i] ?? '').length), col.header.length)
  return Math.min(Math.max(longest + 2, col.type === 'money' ? 14 : 8), 50)
}

export async function downloadExcel(fileBase: string, sheets: XSheet[], opts: { dated?: boolean } = {}) {
  const id = toast.loading('Preparing Excel file…')
  try {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const built = sheets.map((s) => {
      const header = s.columns.map((c) => ({ value: c.header, type: String, fontWeight: 'bold' as const, backgroundColor: '#E6EFE8' }))
      const body = s.rows.map((r) => s.columns.map((c, i) => cell(r[i], c)))
      const data = [header, ...body]
      if (s.totals?.length && s.rows.length) {
        data.push(
          s.columns.map((c, i) =>
            i === 0
              ? { value: 'TOTAL', type: String, fontWeight: 'bold' as const }
              : s.totals!.includes(i)
                ? { value: s.rows.reduce((t, r) => t + (Number(r[i]) || 0), 0), type: Number, fontWeight: 'bold' as const, format: FORMATS[c.type === 'int' ? 'int' : 'money'] }
                : null,
          ),
        )
      }
      return {
        data: data as never,
        sheet: safeSheetName(s.name),
        stickyRowsCount: 1,
        columns: s.columns.map((c, i) => ({ width: width(c, s.rows, i) })),
      }
    })
    const fileName = opts.dated === false ? `${fileBase}.xlsx` : `${fileBase}-${todayLK()}.xlsx`
    const out = built.length === 1 ? writeXlsxFile(built[0].data, built[0]) : writeXlsxFile(built)
    await out.toFile(fileName)
    toast.success(`Downloaded ${fileName}`, { id })
  } catch (e) {
    toast.error(`Excel export failed: ${(e as Error).message}`, { id })
  }
}
