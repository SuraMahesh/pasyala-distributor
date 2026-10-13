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
