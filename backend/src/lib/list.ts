import type { ListQuery, Paged } from '@pjd/shared'

type SortVal = string | number | boolean | null | undefined

/**
 * Search, sort and paginate an in-memory list.
 * Data is pre-filtered in SQL (dates, ids); derived columns (stock, dues, balances)
 * are computed in JS, so final filtering/sorting happens here.
 */
export function paginate<T>(
  items: T[],
  q: ListQuery,
  opts: {
    search?: (t: T) => string
    sorters?: Record<string, (t: T) => SortVal>
    defaultSort?: { key: string; dir: 'asc' | 'desc' }
  } = {},
): Paged<T> & { filtered: T[] } {
  let list = items
  const words = q.search.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length && opts.search) {
    list = list.filter((t) => {
      const hay = opts.search!(t).toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }
  const key = q.sort && opts.sorters?.[q.sort] ? q.sort : opts.defaultSort?.key
  const dir = q.sort && opts.sorters?.[q.sort] ? q.dir : (opts.defaultSort?.dir ?? 'asc')
  const getter = key ? opts.sorters?.[key] : undefined
  if (getter) {
    const m = dir === 'desc' ? -1 : 1
    list = [...list].sort((a, b) => {
      const x = getter(a)
      const y = getter(b)
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * m
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * m
    })
  }
  const total = list.length
  const pageSize = q.pageSize
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(q.page, maxPage)
  return { items: list.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize, filtered: list }
}

/** Natural sort key for sizes: 4.5L before 750ML before 30ML before 100g ... */
export function sizeRank(s: string) {
  const m = s.match(/([\d.]+)\s*(l|ml|kg|g)/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  const u = m[2].toLowerCase()
  return -(u === 'l' || u === 'kg' ? n * 1000 : n)
}
