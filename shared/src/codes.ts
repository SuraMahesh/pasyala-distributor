import type { Category } from './types'

const CATEGORY_PREFIX: Record<Category, string> = {
  'Thailaya (Oil)': 'TH',
  'Arishta / Spirit': 'AR',
  'Choorna / Powder': 'CH',
  'Guli / Tablets': 'GL',
  'Lepa / Paste': 'LP',
  Rasayana: 'RS',
  Honey: 'HN',
  Other: 'OT',
}

/** Size as 4 digits in ml/g, like the supplier codes: 4.5L → 4500, 750ML → 0750, 1kg → 1000, 30g → 0030. */
export function sizeDigits(size: string) {
  const m = size.trim().match(/([\d.]+)\s*(l|ltr|ml|kg|g)\b/i)
  if (!m) return '0000'
  const n = parseFloat(m[1])
  const u = m[2].toLowerCase()
  const v = Math.round(u === 'l' || u === 'ltr' || u === 'kg' ? n * 1000 : n)
  return String(Math.min(v, 9999)).padStart(4, '0')
}

/** Two letters from the name: initials of the first two words, or first letter + next consonant. */
export function nameLetters(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return 'XX'
  if (words.length >= 2) return words[0][0] + words[1][0]
  const w = words[0]
  const next = w.slice(1).match(/[^AEIOU]/)?.[0] ?? w[1] ?? 'X'
  return w[0] + next
}

/**
 * Item code from category + name + size, e.g. THMN0030 for 30ML MAHA NARAYANA oil.
 * The server adds -2, -3 … if the code is already used.
 */
export function suggestProductCode(name: string, size: string, category: Category) {
  return `${CATEGORY_PREFIX[category] ?? 'OT'}${nameLetters(name)}${sizeDigits(size)}`
}

/** Best guess of the category for a product read from a supplier document. */
export function guessCategory(code: string, name: string, existing: { code: string; category: Category }[] = []): Category {
  const prefix = code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
  if (prefix.length === 2) {
    const counts = new Map<Category, number>()
    for (const p of existing) if (p.code.toUpperCase().startsWith(prefix)) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top) return top[0]
  }
  const n = name.toUpperCase()
  if (/THEL|OIL|THAILA/.test(n)) return 'Thailaya (Oil)'
  if (/ARISHT|ASAV|SPRIT|SPIRIT|ARISHTA/.test(n)) return 'Arishta / Spirit'
  if (/CHOORN|CHURN|POWDER/.test(n)) return 'Choorna / Powder'
  if (/TABLET|GULI|PILL|CAPSUL/.test(n)) return 'Guli / Tablets'
  if (/LEPA|BALM|PASTE|CREAM/.test(n)) return 'Lepa / Paste'
  if (/RASAYAN/.test(n)) return 'Rasayana'
  if (/HONEY|MEE PANI/.test(n)) return 'Honey'
  return 'Other'
}
