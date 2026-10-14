import { z } from 'zod'

/** Upload body for POST /api/scan-invoice — base64 file (no data: prefix). ~3.4 MB file max (Vercel body limit 4.5 MB). */
export const scanInvoiceSchema = z.object({
  kind: z.enum(['sale', 'purchase']),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']),
  data: z.string().min(100, 'The file is empty').max(4_600_000, 'The file is too large — use a photo under 3 MB'),
})
export type ScanInvoiceInput = z.infer<typeof scanInvoiceSchema>

/** POST /api/{sales|purchases}/:id/images — a photo of the paper invoice (already shrunk in the browser). */
export const invoiceImageUploadSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** base64 of the stored image (≈1800 px, ≤ 1.5 MB) */
  data: z.string().min(100).max(2_100_000, 'The photo is too large'),
  /** base64 of a small preview (≈320 px) */
  thumb: z.string().min(50).max(300_000),
  /** sha-256 (hex) of the ORIGINAL photo file — stops the same photo being attached twice */
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
})
export type InvoiceImageUpload = z.infer<typeof invoiceImageUploadSchema>
