import { amountInWords, invoiceTotals, lineNet, rs, type InvoiceLine } from '@pjd/shared'

export interface DocParty {
  code?: string
  name?: string
  address?: string
  phone?: string
  type?: string
}

/** Printable invoice laid out like the Pasyale supplier invoices. */
export default function InvoiceDocument({
  title,
  issuer,
  party,
  partyLabel,
  meta,
  lines,
  billDiscPct,
  paidAmount,
  footer,
}: {
  title: string
  issuer: { name: string; address?: string; phone?: string; email?: string }
  party?: DocParty
  partyLabel: string
  meta: [string, string][]
  lines: InvoiceLine[]
  billDiscPct: number
  paidAmount: number
  footer?: string
}) {
  const t = invoiceTotals(lines, billDiscPct)
  return (
    <div className="print-area card mx-auto max-w-4xl bg-white p-4 text-[12px] text-stone-900 sm:p-6 sm:text-[13px] md:p-10">
      <div className="text-center">
        <h2 className="text-lg font-bold tracking-tight sm:text-xl">{issuer.name}</h2>
        {issuer.address && <p className="text-stone-600">{issuer.address}</p>}
        <p className="text-stone-600">{[issuer.phone && `Tel: ${issuer.phone}`, issuer.email && `Email: ${issuer.email}`].filter(Boolean).join(' · ')}</p>
        <p className="mt-3 text-base font-bold tracking-[0.2em] sm:mt-4 sm:text-lg">{title}</p>
      </div>

      <div className="mt-4 grid gap-3 sm:mt-5 sm:grid-cols-2 sm:gap-6">
        <dl className="grid grid-cols-[90px_1fr] gap-y-1 sm:grid-cols-[110px_1fr]">
          <dt className="font-semibold">{partyLabel}</dt>
          <dd>{party?.code ?? '—'}</dd>
          <dt className="font-semibold">Name</dt>
          <dd className="uppercase">{party?.name ?? '—'}</dd>
          {party?.type && (
            <>
              <dt className="font-semibold">Type</dt>
              <dd>{party.type}</dd>
            </>
          )}
          <dt className="font-semibold">Address</dt>
          <dd>{party?.address ?? ''}</dd>
          {party?.phone && (
            <>
              <dt className="font-semibold">Phone</dt>
              <dd>{party.phone}</dd>
            </>
          )}
        </dl>
        <dl className="grid grid-cols-[90px_1fr] gap-y-1 sm:grid-cols-[110px_1fr] sm:justify-self-end">
          {meta.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-semibold">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="-mx-1 mt-4 overflow-x-auto sm:mx-0 sm:mt-5">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-y-2 border-stone-800 text-left text-[11px] uppercase">
              <th className="py-1.5 pr-2">Item code</th>
              <th className="py-1.5 pr-2">Item description</th>
              <th className="py-1.5 pr-2 text-right">Qty</th>
              <th className="py-1.5 pr-2 text-right">Unit price</th>
              <th className="py-1.5 pr-2 text-right">Disc%</th>
              <th className="py-1.5 text-right">Amount (Rs)</th>
            </tr>
          </thead>
          <tbody>
            {lines.flatMap((l, i) => {
              const label = l.name ? `${l.size} ${l.name}` : 'Item'
              const rows = [
                <tr key={i} className="border-b border-stone-100">
                  <td className="py-1 pr-2 font-mono text-[11px]">{l.code}</td>
                  <td className="py-1 pr-2 uppercase">{label}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{l.qty}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{rs(l.unitPrice)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{l.discPct.toFixed(2)}</td>
                  <td className="py-1 text-right tabular-nums">{rs(lineNet(l))}</td>
                </tr>,
              ]
              if (l.freeQty) {
                rows.push(
                  <tr key={`${i}f`} className="border-b border-stone-100 text-stone-600">
                    <td className="py-1 pr-2 font-mono text-[11px]">{l.code}</td>
                    <td className="py-1 pr-2 uppercase">{label} <span className="text-[11px] normal-case">(free)</span></td>
                    <td className="py-1 pr-2 text-right tabular-nums">{l.freeQty}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">0.00</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{l.discPct.toFixed(2)}</td>
                    <td className="py-1 text-right tabular-nums">0.00</td>
                  </tr>,
                )
              }
              return rows
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_280px]">
        <p className="text-[11px]">
          <span className="font-semibold">Amount in words: </span>
          <span className="font-semibold uppercase">{amountInWords(t.netTotal)}</span>
        </p>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1">
          <dt className="font-semibold">Sub Total</dt>
          <dd className="text-right tabular-nums">{rs(t.subTotal)}</dd>
          <dt className="font-semibold">Discount {billDiscPct ? `(${billDiscPct}%)` : ''}</dt>
          <dd className="text-right tabular-nums">{rs(t.billDiscount)}</dd>
          <dt className="border-t border-stone-800 pt-1 font-bold">Net Total</dt>
          <dd className="border-t border-stone-800 pt-1 text-right font-bold tabular-nums">{rs(t.netTotal)}</dd>
          <dt className="text-stone-600">Paid</dt>
          <dd className="text-right tabular-nums text-stone-600">{rs(paidAmount)}</dd>
          <dt className="text-stone-600">Balance</dt>
          <dd className="text-right tabular-nums text-stone-600">{rs(t.netTotal - paidAmount)}</dd>
        </dl>
      </div>

      <div className="mt-12 grid grid-cols-3 gap-4 text-center text-[11px] text-stone-600 sm:mt-14 sm:gap-6">
        {['Prepared by', 'Approved by', 'Customer'].map((s) => (
          <div key={s} className="border-t border-dotted border-stone-500 pt-1">{s}</div>
        ))}
      </div>
      {footer && <p className="mt-6 text-center text-[11px] text-stone-500">{footer}</p>}
    </div>
  )
}
