// All money maths lives here so the backend (source of truth) and the
// frontend (live preview while typing) always produce identical numbers.

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface CalcLine {
  qty: number
  freeQty: number
  unitPrice: number
  discPct: number
}

/** qty × price before any discount */
export const lineGross = (l: CalcLine) => round2(l.qty * l.unitPrice)

/** qty × price × (1 − disc%), rounded to cents — matches the Pasyale invoice print */
export const lineNet = (l: CalcLine) => round2(l.qty * l.unitPrice * (1 - l.discPct / 100))

export interface InvoiceTotals {
  gross: number
  lineDiscount: number
  subTotal: number
  billDiscount: number
  netTotal: number
  units: number
  freeUnits: number
}

export function invoiceTotals(lines: CalcLine[], billDiscPct: number): InvoiceTotals {
  const gross = round2(lines.reduce((s, l) => s + lineGross(l), 0))
  const subTotal = round2(lines.reduce((s, l) => s + lineNet(l), 0))
  const billDiscount = round2((subTotal * billDiscPct) / 100)
  return {
    gross,
    lineDiscount: round2(gross - subTotal),
    subTotal,
    billDiscount,
    netTotal: round2(subTotal - billDiscount),
    units: lines.reduce((s, l) => s + l.qty, 0),
    freeUnits: lines.reduce((s, l) => s + l.freeQty, 0),
  }
}

/**
 * Landed cost per physical unit for a purchase line:
 * line net after the bill discount, spread over paid + free units.
 */
export function landedUnitCost(l: CalcLine, billDiscPct: number) {
  const units = l.qty + l.freeQty
  if (!units) return 0
  return (lineNet(l) * (1 - billDiscPct / 100)) / units
}

/** Revenue a sales line actually brings in after the bill discount */
export const lineRevenue = (l: CalcLine, billDiscPct: number) => lineNet(l) * (1 - billDiscPct / 100)

export function addDays(isoDate: string, days: number) {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86_400_000)
}

/** Today's date in Sri Lanka (UTC+05:30) as yyyy-mm-dd */
export function todayLK(now = new Date()) {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

// ---------- Amount in words (Pasyale invoice style) ----------
const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN']
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY']

function below1000(n: number): string {
  const parts: string[] = []
  if (n >= 100) {
    parts.push(ONES[Math.floor(n / 100)] + ' HUNDRED')
    n %= 100
  }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''))
  else if (n > 0) parts.push(ONES[n])
  return parts.join(' ')
}

function intWords(n: number): string {
  if (n === 0) return 'ZERO'
  const parts: string[] = []
  for (const [v, w] of [[1_000_000_000, 'BILLION'], [1_000_000, 'MILLION'], [1000, 'THOUSAND']] as const) {
    if (n >= v) {
      parts.push(below1000(Math.floor(n / v)) + ' ' + w)
      n %= v
    }
  }
  if (n) parts.push(below1000(n))
  return parts.join(' ')
}

export function amountInWords(amount: number) {
  const neg = amount < 0
  const a = Math.abs(round2(amount))
  const rupees = Math.floor(a)
  const cents = Math.round((a - rupees) * 100)
  return (neg ? 'MINUS ' : '') + intWords(rupees) + (cents ? ' AND CENTS ' + intWords(cents) : '') + ' ONLY'
}

// ---------- formatting ----------
const rsFmt = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qFmt = new Intl.NumberFormat('en-LK')
export const rs = (n: number | null | undefined) => rsFmt.format(n || 0)
export const qtyFmt = (n: number | null | undefined) => qFmt.format(n || 0)
