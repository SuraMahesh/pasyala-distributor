import { z } from 'zod'

/** Upload body for POST /api/scan-invoice — base64 file (no data: prefix). ~3.4 MB file max (Vercel body limit 4.5 MB). */
export const scanInvoiceSchema = z.object({
  kind: z.enum(['sale', 'purchase']),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']),
  data: z.string().min(100, 'The file is empty').max(4_600_000, 'The file is too large — use a photo under 3 MB'),
})
export type ScanInvoiceInput = z.infer<typeof scanInvoiceSchema>
