// Stock-count requests made through the assistant. The assistant can only CREATE them; the owner approves
// (with OWNER_PIN) and only then is a stock adjustment posted — through the same checks as POST /adjustments.
import { and, desc, eq, sql } from 'drizzle-orm'
import { todayLK } from '@pjd/shared'
import type { DB } from '../db/client'
import { assistantRequests, stockAdjustments } from '../db/schema'
import { badRequest, conflict, notFound } from '../errors'
import { assertStockAvailable, stockMap } from './stock'

export function listRequests(db: DB, status: 'pending' | 'all' = 'pending') {
  return db
    .select()
    .from(assistantRequests)
    .where(status === 'all' ? undefined : eq(assistantRequests.status, 'pending'))
    .orderBy(desc(assistantRequests.id))
}

/** Owner approved: post the adjustment inside one transaction, with the oversell check. */
export function applyRequest(db: DB, id: number, approver: string) {
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(assistantRequests).where(eq(assistantRequests.id, id)).for('update')
    if (!req) throw notFound('Request')
    if (req.status !== 'pending') throw conflict(`Request ${id} is already ${req.status}`)
    if (approver.trim().toLowerCase() === req.requestedBy.trim().toLowerCase()) throw badRequest('The person who asked cannot approve their own request')

    // Apply the ORIGINAL difference, not countedQty − today's on hand: the count was true when it was taken, and
    // any sales since then have already been deducted by the ERP. Only warn if stock moved in between.
    const live = (await stockMap(tx, [req.productId])).get(req.productId)
    const moved = live != null && live.onHand !== req.onHand

    await assertStockAvailable(tx, new Map([[req.productId, req.delta]]), 'apply this adjustment')
    const [adj] = await tx
      .insert(stockAdjustments)
      .values({
        date: todayLK(),
        productId: req.productId,
        qty: req.delta,
        reason: req.reason,
        notes: `Assistant request #${req.id}: ${req.notes} (asked by ${req.requestedBy}, approved by ${approver})`.slice(0, 300),
      })
      .returning()
    const [updated] = await tx
      .update(assistantRequests)
      .set({ status: 'applied', approver, adjustmentId: adj.id, decidedAt: new Date() })
      .where(eq(assistantRequests.id, id))
      .returning()
    return {
      ...updated,
      warning: moved ? `Stock moved since the request (was ${req.onHand}, now ${live?.onHand}); the original difference of ${req.delta} was applied.` : null,
    }
  })
}

export async function rejectRequest(db: DB, id: number, approver: string, note: string) {
  const [updated] = await db
    .update(assistantRequests)
    .set({
      status: 'rejected',
      approver,
      // keep the requester's note, append the owner's reason
      notes: note ? sql`${assistantRequests.notes} || ${' · rejected: ' + note}` : undefined,
      decidedAt: new Date(),
    })
    .where(and(eq(assistantRequests.id, id), eq(assistantRequests.status, 'pending')))
    .returning()
  if (!updated) throw conflict('Request not found or already decided')
  return updated
}
