import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codeShape, ocrScore, parseInvoiceText, sizeKey } from '@pjd/shared'
import { SEED_PRODUCTS, SEED_PURCHASES } from './db/seed'
import { buildScanResult, fixDocPrefix } from './services/scan'

// Real Tesseract output from phone photos of the 5 Pasyale invoices (yellow highlights, rotated, folded).
const catalog = SEED_PRODUCTS.map(([code, size, name, , price], i) => ({ id: i + 1, code, size, name, listPrice: price, supplierDiscPct: 22 }))
const codeOf = new Map(catalog.map((c) => [c.id, c.code]))
const fixture = (f: string) => readFileSync(new URL(`./__fixtures__/ocr/${f}.txt`, import.meta.url), 'utf8')
const truthOf = (inv: string) => SEED_PURCHASES.find((p) => p[0] === inv)![3].map(([c, q, fr]) => `${c}:${q}+${fr ?? 0}`)
const read = (f: string) => {
  const r = parseInvoiceText(fixture(f), 'purchase', catalog)
  return { r, got: r.lines!.map((l) => `${l.productId ? codeOf.get(l.productId) : '?'}:${l.qty}+${l.freeQty}`) }
}

describe('offline OCR invoice reading (no API key)', () => {
  it.each([
    ['efcaafa6', 'HOSI005920', 11],
    ['ca640d95', 'HOSI005927', 19],
    ['78adbe42', 'HOSI005928', 1],
    ['62d4f6cb', 'HOSI005942', 4],
  ])('%s → %s: at least %i lines exactly right, nothing invented', (f, inv, min) => {
    const { got } = read(f)
    const truth = truthOf(inv)
    const right = got.filter((g) => truth.includes(g)).length
    expect(right).toBeGreaterThanOrEqual(min)
    // lines that are wrong must be flagged as unmatched or have qty 0 for the user to fill in — not silently wrong codes
    const wrongProduct = got.filter((g) => !g.startsWith('?') && !truth.some((t) => t.split(':')[0] === g.split(':')[0]))
    expect(wrongProduct).toEqual([])
  })

  it('reads the header: invoice no, date, order, sales rep, pay method, bill discount, net total', () => {
    const { r } = read('efcaafa6')
    expect(r).toMatchObject({ invoiceNo: 'HOSI005920', date: '2026-10-09', salesPerson: 'Sudaraka', payMethod: 'Cash', billDiscPct: 8, partyName: 'Pasyale Ayurveda Osu (PVT) LTD' })
    expect(read('ca640d95').r.printedNetTotal).toBe(125472.36)
  })

  it('free issue lines (price 0.00) are added to the paid line as free qty', () => {
    const { got } = read('efcaafa6')
    expect(got).toContain('THSU0030:12+1')
    expect(got).toContain('THKU0030:36+3')
  })

  it('fixes OCR mix-ups in codes, sizes and amounts', () => {
    expect(codeShape('THMNO7S0')).toBe(codeShape('THMN0750'))
    expect(sizeKey('7SOML')).toBe('750ML')
    expect(sizeKey('4SL')).toBe('4.5L')
    expect(sizeKey('1Kg')).toBe('1KG')
    // size one character off ("1180ML") still finds 180ML PINDA
    const r = parseInvoiceText('THPNOISO  1180ML PINDA V     3     850.00     22.00     1,989.00', 'purchase', catalog)
    expect(codeOf.get(r.lines![0].productId!)).toBe('THPN0180')
    // amount with comma read as a dot: 4.11840 → 4,118.40 (24 × 220 − 22%)
    expect(read('415a3004').got).toContain('THSP0030:24+2')
  })

  it('scores the right-way-up text higher (used to rotate photos)', () => {
    expect(ocrScore(fixture('efcaafa6'))).toBeGreaterThan(40)
    expect(ocrScore('~ G11 UAd) NSO EpaainAY ojE 8Z6S00ISOH : oy axoam)')).toBeLessThan(5)
  })

  it('server checks: invoice prefix fixed from earlier invoices, last bill discount used, only supplier chosen', () => {
    expect(fixDocPrefix('FOSI005928', ['HOSI005920', 'HOSI005927'])).toBe('HOSI005928')
    expect(fixDocPrefix('HOS1005942', ['HOSI005920'])).toBe('HOSI005942')
    expect(fixDocPrefix('XYZW123456', ['HOSI005920'])).toBe('XYZW123456')
    const { r } = read('62d4f6cb')
    const res = buildScanResult('purchase', { ...r, partyName: 'garbled', partyCandidates: [] }, catalog, [{ id: 7, name: 'Pasyale Ayurveda Osu (PVT) LTD' }], new Set(['HOSI005920']), { lastBillDisc: new Map([[7, 8]]) })
    expect(res).toMatchObject({ invoiceNo: 'HOSI005942', partyId: 7, billDiscPct: 8 })
    expect(res.warnings.join(' ')).toMatch(/only supplier/)
    expect(res.warnings.join(' ')).toMatch(/using 8% from this supplier's last invoice/)
  })
})
