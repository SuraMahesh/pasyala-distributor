import Anthropic from '@anthropic-ai/sdk'
import { codeShape, invoiceTotals, levenshtein, PAY_METHODS, round2, type PayMethod, type RawScan, type ScanInvoiceInput, type ScanKind, type ScannedLine, type ScanResult } from '@pjd/shared'

export type { RawScan }
import { AppError } from '../errors'

export interface CatalogItem {
  id: number
  code: string
  name: string
  size: string
}
export interface PartyItem {
  id: number
  name: string
}

export type InvoiceScanner = (args: { file: ScanInvoiceInput; catalog: CatalogItem[]; parties: PartyItem[] }) => Promise<RawScan>

// ---------------------------------------------------------------- Claude (vision)

const TOOL: Anthropic.Tool = {
  name: 'record_invoice',
  description: 'Record every detail read from the invoice image.',
  input_schema: {
    type: 'object',
    properties: {
      invoiceNo: { type: ['string', 'null'], description: 'Invoice / bill number exactly as printed' },
      date: { type: ['string', 'null'], description: 'Invoice date as YYYY-MM-DD (convert DD/MM/YYYY; Sri Lankan invoices put the day first)' },
      partyName: { type: ['string', 'null'], description: 'Supplier name (purchase) or customer / shop name (sale)' },
      partyId: { type: ['integer', 'null'], description: 'id from the PARTIES list when the name clearly matches, else null' },
      orderNo: { type: ['string', 'null'] },
      salesPerson: { type: ['string', 'null'], description: 'Sales rep / salesman name if printed' },
      payMethod: { type: ['string', 'null'], enum: [...PAY_METHODS, null], description: 'Cash, Credit, Cheque or Bank Transfer if shown' },
      billDiscPct: { type: ['number', 'null'], description: 'Discount % applied to the whole bill at the bottom (not the per-line discount). 0 if none.' },
      printedNetTotal: { type: ['number', 'null'], description: 'Final net amount payable printed on the invoice' },
      notes: { type: 'array', items: { type: 'string' }, description: 'Anything unclear: unreadable digits, crossed-out lines, handwriting you are unsure of' },
      lines: {
        type: 'array',
        description: 'One entry per printed item line, in order. Skip totals rows.',
        items: {
          type: 'object',
          properties: {
            productId: { type: ['integer', 'null'], description: 'id from the CATALOG whose name AND size match this line; null if not sure' },
            code: { type: ['string', 'null'], description: 'Item code as printed' },
            description: { type: ['string', 'null'], description: 'Item name as printed' },
            size: { type: ['string', 'null'], description: 'Pack size e.g. 30ML, 750ML, 4.5L, 100g, 1kg' },
            qty: { type: ['number', 'null'], description: 'Charged (paid) quantity' },
            freeQty: { type: ['number', 'null'], description: 'Free issue quantity (0 if none)' },
            unitPrice: { type: ['number', 'null'], description: 'Unit price before discount' },
            discPct: { type: ['number', 'null'], description: 'Line discount %' },
            lineTotal: { type: ['number', 'null'], description: 'Line amount as printed' },
          },
          required: ['description', 'qty', 'unitPrice'],
        },
      },
    },
    required: ['lines'],
  },
}

export function claudeScanner(apiKey: string, model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'): InvoiceScanner {
  const client = new Anthropic({ apiKey })
  return async ({ file, catalog, parties }) => {
    const media: Anthropic.ContentBlockParam =
      file.mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } }
        : { type: 'image', source: { type: 'base64', media_type: file.mimeType as 'image/jpeg', data: file.data } }
    const res = await client.messages.create({
      model,
      max_tokens: 8000,
      system:
        'You read invoices for a Sri Lankan distributor of Ayurveda products (oils/thailaya, arishta, choorna, rasayana, honey). ' +
        'Copy numbers exactly as printed — never guess or recalculate. Quantities in the "free" / "FOC" / "free issue" column go in freeQty. ' +
        'Per-line discount % goes in discPct; a discount applied to the whole bill total goes in billDiscPct. ' +
        'Match each line to the CATALOG by name and size; if two catalog items are possible, use null. Add a note for anything you could not read clearly.',
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            media,
            {
              type: 'text',
              text:
                `This is a ${file.mimeType === 'application/pdf' ? 'PDF' : 'photo'} of a ${file.kind === 'purchase' ? 'SUPPLIER invoice (we are buying stock)' : 'SALES invoice (we sold to a shop / medical center)'}.\n\n` +
                `CATALOG (id | code | size | name):\n${catalog.map((c) => `${c.id} | ${c.code} | ${c.size} | ${c.name}`).join('\n')}\n\n` +
                `PARTIES (id | name):\n${parties.map((p) => `${p.id} | ${p.name}`).join('\n') || '(none)'}\n\n` +
                'Call record_invoice with everything on the invoice.',
            },
          ],
        },
      ],
    })
    const tool = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (!tool) throw new AppError(502, 'Could not read the invoice — try a clearer photo.')
    return tool.input as RawScan
  }
}

export function defaultScanner(): InvoiceScanner | null {
  const key = process.env.ANTHROPIC_API_KEY
  return key ? claudeScanner(key) : null
}

// ---------------------------------------------------------------- matching + checks

const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9.]/g, '')
const normSize = (s: string | null | undefined) => norm(s).replace(/\.0+(?=[A-Z])/, '').replace(/LTR|LITRE|LITER/, 'L').replace(/GRAM|GMS|GM/, 'G')

function bigrams(s: string) {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}
/** Dice similarity 0…1 on letter pairs */
export function similarity(a: string, b: string) {
  const x = bigrams(norm(a).replace(/[0-9.]/g, ''))
  const y = bigrams(norm(b).replace(/[0-9.]/g, ''))
  if (!x.length || !y.length) return 0
  const pool = [...y]
  let hit = 0
  for (const g of x) {
    const i = pool.indexOf(g)
    if (i >= 0) {
      hit++
      pool.splice(i, 1)
    }
  }
  return (2 * hit) / (x.length + y.length)
}

const num = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v.replace(/,/g, '')) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0
}

export function buildScanResult(
  kind: ScanKind,
  raw: RawScan,
  catalog: CatalogItem[],
  parties: PartyItem[],
  existingInvoiceNos: Set<string> = new Set(),
  opts: { lastBillDisc?: Map<number, number> } = {},
): ScanResult {
  const warnings: string[] = []
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const byCode = new Map(catalog.map((c) => [norm(c.code), c]))

  const lines: ScannedLine[] = (raw.lines ?? []).map((l, i) => {
    const rawText = [l.code, l.size, l.description].filter(Boolean).join(' ').trim() || `Line ${i + 1}`
    let productId: number | null = null
    let matchedBy: ScannedLine['matchedBy'] = null
    const ai = l.productId != null ? byId.get(Number(l.productId)) : undefined
    const code = l.code ? byCode.get(norm(l.code)) : undefined
    if (code) {
      productId = code.id
      matchedBy = 'code'
    } else if (ai && (!l.size || levenshtein(normSize(ai.size), normSize(l.size)) <= 1)) {
      productId = ai.id
      matchedBy = 'ai'
    } else {
      const sized = catalog.filter((c) => !l.size || normSize(c.size) === normSize(l.size))
      const scored = sized.map((c) => ({ c, s: similarity(c.name, l.description ?? '') })).sort((a, b) => b.s - a.s)
      if (scored[0] && scored[0].s >= 0.72 && (!scored[1] || scored[0].s - scored[1].s >= 0.08)) {
        productId = scored[0].c.id
        matchedBy = 'name'
      }
    }
    if (!productId) warnings.push(`Line ${i + 1} "${rawText}" — product not found, choose it from the list`)
    const qty = Math.round(num(l.qty))
    const freeQty = Math.round(num(l.freeQty))
    const unitPrice = round2(num(l.unitPrice))
    const discPct = num(l.discPct, 0, 100)
    const printedLineTotal = l.lineTotal == null ? null : round2(num(l.lineTotal))
    if (printedLineTotal != null && qty > 0) {
      const calc = round2(qty * unitPrice * (1 - discPct / 100))
      const gross = round2(qty * unitPrice)
      if (Math.abs(calc - printedLineTotal) > 1 && Math.abs(gross - printedLineTotal) > 1) {
        warnings.push(`Line ${i + 1} "${rawText}": ${qty} × ${unitPrice} − ${discPct}% = ${calc}, but the invoice shows ${printedLineTotal} — check qty, price and discount`)
      }
    }
    if (!qty && !freeQty) warnings.push(`Line ${i + 1} "${rawText}" has no quantity`)
    return { productId, rawText, matchedBy, qty, freeQty, unitPrice, discPct, printedLineTotal }
  })
  if (!lines.length) warnings.push('No item lines were found on the image — check it is the right page')

  // party
  let partyId: number | null = null
  const partyName = (raw.partyName ?? '').trim()
  if (raw.partyId != null && parties.some((p) => p.id === Number(raw.partyId))) partyId = Number(raw.partyId)
  else {
    const names = [partyName, ...(raw.partyCandidates ?? [])].filter((n) => n && n.trim())
    const best = parties.flatMap((p) => names.map((n) => ({ p, s: similarity(p.name, n) }))).sort((a, b) => b.s - a.s)[0]
    if (best && best.s >= 0.6) partyId = best.p.id
  }
  if (!partyId && kind === 'purchase' && parties.length === 1) {
    partyId = parties[0].id
    warnings.push(`Supplier name not read clearly — set to ${parties[0].name} (your only supplier)`)
  } else if (!partyId) warnings.push(partyName ? `${kind === 'purchase' ? 'Supplier' : 'Customer'} "${partyName}" not found — choose one` : `Choose the ${kind === 'purchase' ? 'supplier' : 'customer'}`)

  // header
  const date = raw.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) && !Number.isNaN(Date.parse(raw.date)) ? raw.date : null
  if (!date) warnings.push('Invoice date not read — check the date')
  let invoiceNo = (raw.invoiceNo ?? '').trim().toUpperCase()
  const fixed = fixDocPrefix(invoiceNo, [...existingInvoiceNos])
  if (fixed !== invoiceNo) {
    warnings.push(`Invoice number read as ${invoiceNo} — changed to ${fixed} to match earlier invoices. Check it.`)
    invoiceNo = fixed
  }
  if (kind === 'purchase' && !invoiceNo) warnings.push('Invoice number not read — type it in')
  if (kind === 'purchase' && invoiceNo && existingInvoiceNos.has(norm(invoiceNo))) warnings.push(`Invoice ${invoiceNo} is already entered — this may be a duplicate`)
  let billDiscPct = num(raw.billDiscPct, 0, 100)
  if (raw.billDiscPct == null) {
    const last = partyId ? opts.lastBillDisc?.get(partyId) : undefined
    billDiscPct = last ?? 0
    if (raw.lines?.length) warnings.push(last != null ? `Bill discount not read — using ${last}% from this supplier's last invoice` : 'Bill discount not read — enter it if there is one')
  }
  const payMethod = PAY_METHODS.find((m) => m.toLowerCase() === (raw.payMethod ?? '').toLowerCase()) ?? null

  const printedNetTotal = raw.printedNetTotal == null ? null : round2(num(raw.printedNetTotal))
  if (printedNetTotal != null && lines.length) {
    const t = invoiceTotals(lines, billDiscPct)
    if (Math.abs(t.netTotal - printedNetTotal) > 1) {
      warnings.push(`Total from the lines is Rs ${t.netTotal.toFixed(2)} but the invoice shows Rs ${printedNetTotal.toFixed(2)} — a line or discount may be read wrong`)
    }
  }
  for (const n of raw.notes ?? []) if (n?.trim()) warnings.push(n.trim())

  return {
    kind,
    invoiceNo,
    date,
    partyId,
    partyName,
    orderNo: (raw.orderNo ?? '').trim(),
    salesPerson: (raw.salesPerson ?? '').trim(),
    payMethod: payMethod as PayMethod | null,
    billDiscPct,
    printedNetTotal,
    lines,
    warnings,
  }
}

/** "FOSI005928" / "HOS1005942" → "HOSI0059xx" when earlier invoices start with HOSI and the rest looks right. */
export function fixDocPrefix(no: string, earlier: string[]) {
  if (!no || !earlier.length) return no
  const counts = new Map<string, number>()
  for (const e of earlier) {
    const x = e.match(/^([A-Z]{2,5})(\d{4,8})$/)
    if (x && e.length === no.length) counts.set(x[1], (counts.get(x[1]) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) return no
  const prefix = top[0]
  const head = codeShape(no.slice(0, prefix.length))
  const want = codeShape(prefix)
  let diff = 0
  for (let i = 0; i < want.length; i++) if (head[i] !== want[i]) diff++
  const rest = no.slice(prefix.length).replace(/[OD]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8')
  return diff <= 1 && /^\d+$/.test(rest) ? prefix + rest : no
}
