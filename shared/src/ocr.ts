// Offline invoice reading: turns OCR text (from Tesseract in the browser) into a RawScan.
// No AI involved — tuned for Pasyale-style invoices:  CODE  SIZE NAME  QTY  UNIT PRICE  DISC%  AMOUNT
// and also handles a separate FREE column (our own printed sales invoices).

import { round2 } from './calc'

/** What a reader (AI or OCR) got off the invoice, before it is checked against the database. */
export interface RawScan {
  invoiceNo?: string | null
  date?: string | null
  partyName?: string | null
  /** other names seen on the page (header / "cheque in favour of …") */
  partyCandidates?: string[] | null
  partyId?: number | null
  orderNo?: string | null
  salesPerson?: string | null
  payMethod?: string | null
  billDiscPct?: number | null
  printedNetTotal?: number | null
  notes?: string[] | null
  lines?: {
    productId?: number | null
    code?: string | null
    description?: string | null
    size?: string | null
    qty?: number | null
    freeQty?: number | null
    unitPrice?: number | null
    discPct?: number | null
    lineTotal?: number | null
  }[]
}

export interface OcrCatalogItem {
  id: number
  code: string
  name: string
  size: string
  listPrice: number
  supplierDiscPct: number
}

// ------------------------------------------------------------------ text helpers

/** Code "shape" that is the same for common OCR mix-ups (O/0, I/1, S/5, B/8 …). */
export function codeShape(s: string) {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/[ODQU]/g, '0')
    .replace(/[IL|!J]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/G/g, '6')
    .replace(/Z/g, '2')
}

export function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

function bigramSim(a: string, b: string) {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '')
  const x = clean(a)
  const y = clean(b)
  if (x.length < 2 || y.length < 2) return 0
  const grams = (s: string) => Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2))
  const pool = grams(y)
  let hit = 0
  for (const g of grams(x)) {
    const i = pool.indexOf(g)
    if (i >= 0) {
      hit++
      pool.splice(i, 1)
    }
  }
  return (2 * hit) / (x.length - 1 + y.length - 1)
}

const digitFix = (s: string) => s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8')

/** "7SOML" → "750ML", "1Kg" → "1KG", "4.5 L" → "4.5L" */
export function sizeKey(s: string) {
  const m = s.toUpperCase().replace(/\s+/g, '').match(/^([0-9OSIBL|.]+?)(ML|KG|L|G)$/)
  if (!m) return s.toUpperCase().replace(/\s+/g, '')
  let n = digitFix(m[1]).replace(/^\.+|\.+$/g, '')
  // "4SL" → 45L → 4.5L (no 45-litre packs)
  if (m[2] === 'L' && !n.includes('.') && parseFloat(n) >= 10) n = String(parseFloat(n) / 10)
  return `${n}${m[2]}`
}

// size token somewhere in a line: needs at least one real digit
const SIZE_RE = /(?<![A-Za-z0-9])([0-9OSIBl|][0-9OSIBl|.]{0,4})\s?(ML|Ml|ml|KG|Kg|kg|L|G|g)(?=[^a-z]|$)/g

function findSize(line: string): { key: string; index: number; end: number } | null {
  for (const m of line.matchAll(SIZE_RE)) {
    if (!/\d/.test(m[1])) continue
    const key = sizeKey(m[1] + m[2])
    if (!/^\d+(\.\d+)?(ML|KG|L|G)$/.test(key)) continue
    const v = parseFloat(key)
    if (v <= 0 || v > 5000) continue
    return { key, index: m.index!, end: m.index! + m[0].length }
  }
  return null
}

/** numeric tokens like 1,118.40 / 22.00 / 24 (OCR O→0 fixed). Returns raw strings. */
function numberTokens(s: string): string[] {
  const out: string[] = []
  for (const t of s.split(/\s+/)) {
    const c = t.replace(/^[^\dOo]+|[^\dOo]+$/g, '')
    if (!c) continue
    const fixed = /\d/.test(c) ? c.replace(/[Oo]/g, '0') : c
    if (/^\d[\d,]*(\.\d{1,2})?$/.test(fixed)) out.push(fixed)
  }
  return out
}
const num = (t: string) => parseFloat(t.replace(/,/g, ''))
const hasDecimals = (t: string) => /\.\d{1,2}$/.test(t)

const MONEY_RE = /\b\d{1,3}(?:,\d{3})*\.\d\d\b/g

/** How "invoice-like" an OCR result is — used to find which way up the photo is. */
export function ocrScore(text: string) {
  return (
    (text.match(MONEY_RE) ?? []).length +
    2 * (text.match(/\b[A-Z]{4}-?[A-Z]?[0-9OIS]{4}\b/g) ?? []).length +
    5 * (text.match(/total|invoice|discount|amount|price|qty/gi) ?? []).length
  )
}

// ------------------------------------------------------------------ product matching

interface Match {
  item: OcrCatalogItem
  score: number
}

function matchProduct(codeText: string, sizeKeyRead: string | null, nameText: string, catalog: OcrCatalogItem[], priceRead: number | null): Match | null {
  const shape = codeShape(codeText)
  const rawCode = codeText.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const knownSizes = new Set(catalog.map((c) => sizeKey(c.size)))
  const nameReadable = nameText.replace(/[^A-Za-z]/g, '').length >= 4
  let best: Match | null = null
  for (const item of catalog) {
    const exactCode = rawCode.length >= 6 && rawCode === item.code.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const codeD = shape.length >= 6 ? levenshtein(shape, codeShape(item.code)) : 99
    const itemSize = sizeKey(item.size)
    // "1180ML" for 180ML: one character off and no product has the size as read
    const sizeOk = sizeKeyRead == null || itemSize === sizeKeyRead || (!knownSizes.has(sizeKeyRead) && levenshtein(itemSize, sizeKeyRead) <= 1)
    const ns = bigramSim(item.name, nameText)
    const priceSame = !!priceRead && priceRead === item.listPrice
    // Rules — a wrong match silently changes the wrong product, so be strict:
    //  1. the exact code always matches
    //  2. a code 1 character off (O/0, S/5 …) needs the right size and a name that does not contradict it
    //  3. otherwise the name must clearly be the same and the size must agree
    //     (or: similar name + same size + same unit price)
    const ok =
      exactCode ||
      (codeD <= 1 && sizeOk && (!nameReadable || ns >= 0.4)) ||
      (codeD === 2 && sizeOk && ns >= 0.65) ||
      (sizeOk && sizeKeyRead != null && ns >= 0.72) ||
      (itemSize === sizeKeyRead && priceSame && ns >= 0.5)
    if (!ok) continue
    const score = (exactCode ? 10 : 0) + (3 - Math.min(codeD, 3)) + (itemSize === sizeKeyRead ? 1.5 : 0) + ns * 2 + (priceSame ? 0.8 : 0)
    if (!best || score > best.score) best = { item, score }
  }
  return best
}

// ------------------------------------------------------------------ numbers on one item line

interface Nums {
  qty: number
  freeQty: number
  unitPrice: number
  discPct: number
  lineTotal: number | null
  ok: boolean
}

const STRICT_MONEY = /^\d{1,3}(,\d{3})*\.\d\d$/

function solveNumbers(tokens: string[], p: OcrCatalogItem | undefined, hasFreeCol: boolean): Nums | null {
  const pi = tokens.findIndex((t) => hasDecimals(t))
  if (pi < 0) return null
  const ints = tokens.slice(0, pi).filter((t) => !hasDecimals(t)).map(num)
  let qty = 0
  let freeCol = 0
  if (hasFreeCol && ints.length >= 2) {
    qty = ints[ints.length - 2]
    freeCol = ints[ints.length - 1]
  } else if (ints.length) qty = ints[ints.length - 1]
  let price = num(tokens[pi])
  const after = tokens.slice(pi + 1)
  // amount 0.00 = free issue line even if the 0.00 price was misread
  if (after.length && num(after[after.length - 1]) === 0 && hasDecimals(after[after.length - 1]) && (qty || freeCol)) {
    return { qty: 0, freeQty: qty || freeCol, unitPrice: 0, discPct: p?.supplierDiscPct ?? 0, lineTotal: 0, ok: true }
  }
  const dTok = after.length >= 2 ? after[0] : after.length === 1 && num(after[0]) <= 100 ? after[0] : null
  const aTok = after.length >= 2 ? after[after.length - 1] : after.length === 1 && num(after[0]) > 100 ? after[0] : null
  const dRaw = dTok ? num(dTok) : NaN

  // free line: price 0
  if (price === 0) {
    return { qty: 0, freeQty: qty || freeCol, unitPrice: 0, discPct: p?.supplierDiscPct ?? (dRaw <= 100 ? dRaw : 0), lineTotal: 0, ok: (qty || freeCol) > 0 }
  }

  const discOptions = [...new Set([dRaw, p?.supplierDiscPct, 22].filter((d): d is number => d != null && Number.isFinite(d) && d >= 0 && d <= 100))]
  const strong = aTok != null && STRICT_MONEY.test(aTok)
  const a0 = aTok != null ? num(aTok) : NaN
  // an amount that lost its decimal point ("18720" for 1,872.0) is more likely smaller
  const digits = aTok ? parseFloat(aTok.replace(/\D/g, '')) : NaN
  // "4.11840" (comma read as a dot) → 4,118.40 ; "18720" (lost dot) → 1,872.0
  const amtOptions = !Number.isFinite(a0) ? [] : strong ? [a0] : [...new Set([digits / 100, digits / 10, a0 / 10, a0 / 100, a0])]
  const priceOptions = [...new Set([price, p?.listPrice].filter((x): x is number => !!x && x > 0))]
  const calc = (q: number, pr: number, d: number) => round2(q * pr * (1 - d / 100))

  // 1. what we read is consistent
  for (const a of amtOptions) for (const pr of priceOptions) for (const d of discOptions) {
    if (qty > 0 && Math.abs(calc(qty, pr, d) - a) <= 1) return { qty, freeQty: freeCol, unitPrice: pr, discPct: d, lineTotal: round2(a), ok: true }
  }
  // 2. qty unreadable / misread → work it out from the amount
  const similarQty = (q: number) => !qty || levenshtein(String(q), String(qty)) <= 1
  for (const a of amtOptions) for (const pr of priceOptions) for (const d of discOptions) {
    const q = a / (pr * (1 - d / 100))
    const rq = Math.round(q)
    if (rq >= 1 && rq < 100000 && Math.abs(q - rq) < 0.01 && (strong || similarQty(rq))) {
      return { qty: rq, freeQty: freeCol, unitPrice: pr, discPct: d, lineTotal: round2(a), ok: true }
    }
  }
  // 3. could not check — use what was read, with the product's usual discount
  const disc = p?.supplierDiscPct ?? (Number.isFinite(dRaw) && dRaw <= 100 ? dRaw : 0)
  if (p && Math.abs(price - p.listPrice) / p.listPrice > 0.5) price = p.listPrice
  return { qty, freeQty: freeCol, unitPrice: price, discPct: disc, lineTotal: strong ? a0 : null, ok: false }
}

// ------------------------------------------------------------------ header

function after(line: string, label: RegExp) {
  const m = line.match(label)
  if (!m) return ''
  return line.slice(m.index! + m[0].length).replace(/^[\s:;.,=+-]+/, '').trim()
}

function findDate(text: string): string | null {
  const lines = text.split('\n')
  const order = [...lines.filter((l) => /date/i.test(l) && !/print/i.test(l)), ...lines.filter((l) => !/print/i.test(l)), ...lines]
  for (const l of order) {
    let m = l.match(/(20\d\d)[-./](\d{1,2})[-./](\d{1,2})/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    m = l.match(/\b(\d{1,2})[-./](\d{1,2})[-./](20\d\d)\b/)
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

const docNo = (s: string) => {
  const t = s.split(/\s+/).find((w) => /\d{3,}/.test(w) && !/\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(w) && w.replace(/[^A-Za-z0-9]/g, '').length >= 6)
  if (!t) return ''
  const w = t.replace(/[^A-Za-z0-9-]/g, '').toUpperCase()
  const m = w.match(/^([A-Z0-9]{0,5}?)([0-9][0-9OILSB]{4,})$/)
  return m ? m[1] + digitFix(m[2]) : w
}

// ------------------------------------------------------------------ main

export function parseInvoiceText(text: string, kind: 'sale' | 'purchase', catalog: OcrCatalogItem[]): RawScan {
  const rawLines = text.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim())
  const notes: string[] = []
  const byId = new Map(catalog.map((c) => [c.id, c]))

  // header ------------------------------------------------------------
  let invoiceNo = ''
  let orderNo = ''
  let salesPerson = ''
  let payMethod: string | null = null
  let customerName = ''
  const partyCandidates: string[] = []
  rawLines.slice(0, 6).forEach((l) => {
    if (/\b(pvt|ltd|limited|\(pvt\))\b/i.test(l) && !/cheque/i.test(l)) partyCandidates.push(l.replace(/[^A-Za-z() .&-]/g, ' ').replace(/\s+/g, ' ').trim())
  })
  const segments = rawLines.slice(0, Math.max(rawLines.findIndex((l) => findSize(l) && numberTokens(l).length >= 2), 12)).flatMap((l) => l.split(/\s{3,}(?=\S+\s*\S*\s*[:;])/))
  for (const l of [...segments, ...rawLines]) {
    if (!invoiceNo && !/order|customer|date|print|amount/i.test(l) && /(nv|olce|voice|bill|inv|\bno\b)/i.test(l)) {
      const tail = l.split(/:|no\.?\s/i).pop() ?? ''
      const cand = docNo(tail) || docNo(l.split(/\s{2,}/).pop() ?? '')
      if (cand && /[A-Z]/.test(cand.slice(0, 2))) invoiceNo = cand
    }
    if (!orderNo && /order\s*n/i.test(l)) orderNo = docNo(after(l, /order\s*n[o0]\.?/i))
    if (!salesPerson && /sales\s*pers|sales\s*rep|salesman/i.test(l)) salesPerson = after(l, /sales\s*(person|rep)|salesman/i).split(/\s{2,}/)[0].replace(/[^A-Za-z .]/g, '').trim()
    if (!payMethod && /pay/i.test(l)) {
      const m = l.match(/\b(cash|credit|cheque|bank)\b/i)
      if (m) payMethod = m[1].toLowerCase() === 'bank' ? 'Bank Transfer' : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
    }
    if (!customerName && /^\s*(name|customer\s*name|bill\s*to)\b/i.test(l)) customerName = after(l, /^\s*(name|customer\s*name|bill\s*to)/i).split(/\s{2,}/)[0].replace(/[^A-Za-z .&-]/g, '').trim()
    const fav = l.match(/favou?r\s+of\s+(.+)/i)
    if (fav) partyCandidates.push(fav[1].replace(/[^A-Za-z() .&-]/g, ' ').replace(/\s+/g, ' ').trim())
  }

  // totals ------------------------------------------------------------
  let billDiscPct: number | null = null
  let printedNetTotal: number | null = null
  for (const l of rawLines) {
    if (billDiscPct == null && /discount/i.test(l) && !/line/i.test(l)) {
      const nums = numberTokens(after(l, /discount/i)).map(num)
      const pct = nums.find((n) => n > 0 && n <= 50)
      if (pct != null) billDiscPct = pct
    }
    if (/net\s*t[o0]tal|grand\s*total|total\s*payable/i.test(l)) {
      const k = rawLines.indexOf(l)
      for (const cand of [after(l, /net\s*t[o0]tal|grand\s*total|total\s*payable/i), rawLines[k + 1] ?? '']) {
        const m = cand.match(/\b\d{1,3}(?:,\d{3})+\.\d\d?\b|\b\d{1,3}\.\d\d\b/g)
        if (m) {
          printedNetTotal = num(m[m.length - 1])
          break
        }
      }
    }
  }

  // item lines --------------------------------------------------------
  const firstItem = rawLines.findIndex((l) => findSize(l) && numberTokens(l).length >= 2)
  const hasFreeCol = rawLines.slice(0, Math.max(firstItem, 0)).some((l) => /\bfree\b|\bF\.?O\.?C\b|bonus/i.test(l))
  const stopAt = rawLines.findIndex((l) => /amount\s*in\s*words|sub\s*t[o0]tal/i.test(l))
  const body = stopAt >= 0 ? rawLines.slice(0, stopAt) : rawLines
  type Line = NonNullable<RawScan['lines']>[number] & { _ok?: boolean }
  const lines: Line[] = []
  for (let i = 0; i < body.length; i++) {
    const l = body[i]
    const size = findSize(l)
    if (!size) continue
    const codeText = l.slice(0, size.index).trim().split(/\s+/).filter((w) => /[A-Za-z0-9]{4,}/.test(w)).pop() ?? ''
    let rest = l.slice(size.end)
    // name = letters before the first number
    const firstNum = rest.search(/\s\d[\d,]*(\.\d\d)?(\s|$)/)
    const nameText = (firstNum >= 0 ? rest.slice(0, firstNum) : rest).replace(/[^A-Za-z/ ]/g, ' ').trim()
    let tokens = numberTokens(firstNum >= 0 ? rest.slice(firstNum) : '')
    // numbers wrapped onto the next line(s)
    while (tokens.filter(hasDecimals).length < 2 && i + 1 < body.length && !findSize(body[i + 1]) && numberTokens(body[i + 1]).length) {
      i++
      rest += ' ' + body[i]
      tokens = [...tokens, ...numberTokens(body[i])]
    }
    const firstPrice = tokens.find(hasDecimals)
    const match = matchProduct(codeText, size.key, nameText, catalog, firstPrice ? num(firstPrice) : null)
    const p = match?.item
    const n = solveNumbers(tokens, p, hasFreeCol)
    if (!n) {
      notes.push(`Could not read the numbers for "${(codeText + ' ' + size.key + ' ' + nameText).trim()}" — type them in`)
      lines.push({ productId: p?.id ?? null, code: codeText, size: size.key, description: nameText, qty: 0, freeQty: 0, unitPrice: p?.listPrice ?? 0, discPct: p?.supplierDiscPct ?? 0, lineTotal: null, _ok: false })
      continue
    }
    // free issue on its own line → add to the paid line of the same product
    if (n.unitPrice === 0 && n.freeQty === 0) {
      notes.push(`Free qty for "${p ? `${p.size} ${p.name}` : codeText}" could not be read — check the Free column`)
      continue
    }
    if (n.unitPrice === 0 && n.freeQty > 0) {
      const prev = [...lines].reverse().find((x) => (p ? x.productId === p.id : codeShape(x.code ?? '') === codeShape(codeText)) && !x.freeQty)
      if (prev) {
        prev.freeQty = n.freeQty
        continue
      }
      lines.push({ productId: p?.id ?? null, code: codeText, size: size.key, description: nameText, qty: 0, freeQty: n.freeQty, unitPrice: p?.listPrice ?? 0, discPct: p?.supplierDiscPct ?? n.discPct, lineTotal: 0, _ok: true })
      continue
    }
    lines.push({ productId: p?.id ?? null, code: codeText, size: size.key, description: nameText, qty: n.qty, freeQty: n.freeQty, unitPrice: n.unitPrice, discPct: n.discPct, lineTotal: n.lineTotal, _ok: n.ok })
  }
  const unsure = lines.filter((l) => !l._ok && l.qty).length
  if (unsure) notes.push(`${unsure} line(s) could not be checked against the printed amount — compare qty, price and discount with the image`)

  return {
    invoiceNo: invoiceNo || null,
    date: findDate(text),
    partyName: kind === 'sale' ? customerName || null : partyCandidates[0] ?? null,
    partyCandidates,
    orderNo: orderNo || null,
    salesPerson: salesPerson || null,
    payMethod,
    billDiscPct,
    printedNetTotal,
    notes,
    lines: lines.map(({ _ok, ...l }) => ({ ...l, productId: l.productId && byId.has(l.productId) ? l.productId : null })),
  }
}
