import type { Deps } from '../core/deps.js';
import type { Logger } from '../core/logger.js';
import { handleVerifiedEvent } from './fulfillment.js';

export const MAX_RECONCILE_PAGE = 50;

export interface ReconcileReport {
  scanned: number;
  fulfilled: number;
  alreadyFulfilled: number;
  mismatches: number;
  nextCursor: string | null;
}

/**
 * Pulls completed Checkout Sessions from the provider and runs them through the same idempotent handler as webhooks.
 * Recovers missed deliveries without duplicating access. Bounded per call (≤50 sessions) to respect the 45-second limit;
 * the owner repeats the call with nextCursor.
 */
export async function reconcilePayments(
  deps: Deps,
  log: Logger,
  input: { createdSinceUnix: number; startingAfter?: string; limit?: number },
): Promise<ReconcileReport> {
  const page = await deps.payments().listCheckoutSessions({
    createdSinceUnix: input.createdSinceUnix,
    limit: Math.min(input.limit ?? MAX_RECONCILE_PAGE, MAX_RECONCILE_PAGE),
    ...(input.startingAfter ? { startingAfter: input.startingAfter } : {}),
  });
  const report: ReconcileReport = { scanned: 0, fulfilled: 0, alreadyFulfilled: 0, mismatches: 0, nextCursor: null };
  for (const session of page.data) {
    report.scanned += 1;
    if (session.status !== 'complete' || session.paymentStatus !== 'paid') continue;
    const outcome = await handleVerifiedEvent(deps, log, {
      id: `reconcile:${session.id}`,
      type: 'checkout.session.completed',
      object: { id: session.id } as Record<string, unknown>,
    });
    if (outcome === 'fulfilled') report.fulfilled += 1;
    else if (outcome === 'already_fulfilled' || outcome === 'duplicate_event') report.alreadyFulfilled += 1;
    else if (outcome === 'recorded_mismatch') report.mismatches += 1;
  }
  if (page.hasMore && page.data.length) report.nextCursor = page.data[page.data.length - 1].id;
  return report;
}
