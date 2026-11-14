import type { Tx } from '../core/db.js';
import { RetryableError, MismatchError, type HandleOutcome } from './payment-errors.js';
import { accessChangedMessage } from './templates.js';
import type { MailMessage } from '../core/ports.js';

/** Outcome plus an email to send only after the transaction commits. */
export interface RefundApplied {
  outcome: HandleOutcome;
  afterCommit?: { id: string; message: MailMessage };
}
import { recomputeEntitlement } from './entitlements.js';
import { audit } from './audit.js';
import { enqueue } from './outbox.js';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const int = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) ? value : NaN);

interface OrderRow {
  id: string;
  customer_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  refunded_minor: number;
}

async function lockOrder(tx: Tx, paymentIntentId: string): Promise<OrderRow> {
  const { rows } = await tx.query<OrderRow>(
    `SELECT id, customer_id, amount_minor, currency, status, refunded_minor FROM orders WHERE provider_payment_id = $1 FOR UPDATE`,
    [paymentIntentId],
  );
  // An out-of-order event (refund before the paid checkout was processed) is retried rather than dropped.
  if (!rows[0]) throw new RetryableError('Order for this payment is not recorded yet.');
  return rows[0];
}

async function revokeOrderGrants(tx: Tx, orderId: string, reason: string): Promise<{ customerId: string; productId: string } | null> {
  const { rows } = await tx.query<{ customer_id: string; product_id: string }>(
    `UPDATE entitlement_grants SET status = 'revoked', reason = $2, updated_at = now()
      WHERE order_id = $1 AND status <> 'revoked' RETURNING customer_id, product_id`,
    [orderId, reason],
  );
  if (rows[0]) await recomputeEntitlement(tx, rows[0].customer_id, rows[0].product_id);
  return rows[0] ? { customerId: rows[0].customer_id, productId: rows[0].product_id } : null;
}

async function setGrantsForOrder(tx: Tx, orderId: string, from: 'active' | 'suspended', to: 'active' | 'suspended'): Promise<void> {
  const { rows } = await tx.query<{ customer_id: string; product_id: string }>(
    `UPDATE entitlement_grants SET status = $3, updated_at = now()
      WHERE order_id = $1 AND status = $2 RETURNING customer_id, product_id`,
    [orderId, from, to],
  );
  for (const row of rows) await recomputeEntitlement(tx, row.customer_id, row.product_id);
}

async function productTitle(tx: Tx, orderId: string): Promise<string> {
  const { rows } = await tx.query<{ title_snapshot: string }>('SELECT title_snapshot FROM order_items WHERE order_id = $1 LIMIT 1', [orderId]);
  return rows[0]?.title_snapshot ?? 'your purchase';
}

/**
 * Records a refund. Totals come from the refunds table (one row per provider refund ID), so redelivery is a no-op
 * and a late, smaller event can never lower the refunded total. A full refund revokes only the grant tied to this order.
 */
export async function applyRefund(tx: Tx, refund: Record<string, unknown>): Promise<RefundApplied> {
  const refundId = str(refund.id);
  const status = str(refund.status);
  if (!refundId) throw new MismatchError('Refund has no identifier.');
  if (status === 'failed' || status === 'canceled') return { outcome: 'ignored' };
  const amount = int(refund.amount);
  const currency = str(refund.currency).toUpperCase();
  if (!Number.isInteger(amount) || amount <= 0) throw new MismatchError('Refund amount is not valid.');
  const order = await lockOrder(tx, str(refund.payment_intent));
  if (currency !== order.currency) throw new MismatchError('Refund currency does not match the order.');

  const inserted = await tx.query(
    `INSERT INTO refunds (id, order_id, provider_refund_id, amount_minor, currency)
     VALUES (gen_random_uuid(), $1, $2, $3, $4) ON CONFLICT (provider_refund_id) DO NOTHING RETURNING id`,
    [order.id, refundId, amount, currency],
  );
  if (inserted.rowCount === 0) return { outcome: 'duplicate_event' };

  const { rows } = await tx.query<{ total: string }>('SELECT COALESCE(SUM(amount_minor), 0)::text AS total FROM refunds WHERE order_id = $1', [order.id]);
  const total = Number(rows[0].total);
  if (total > order.amount_minor) throw new MismatchError('Refunds exceed the order amount.');

  const full = total >= order.amount_minor;
  const nextStatus = order.status === 'disputed' ? 'disputed' : full ? 'refunded' : 'partially_refunded';
  await tx.query('UPDATE orders SET status = $2, refunded_minor = $3 WHERE id = $1', [order.id, nextStatus, total]);
  await audit(tx, {
    actor: 'system:stripe',
    action: full ? 'refund.full' : 'refund.partial',
    subjectType: 'order',
    subjectId: order.id,
    details: { refundedMinor: total, ownerActionRequired: !full },
  });

  if (full) {
    const revoked = await revokeOrderGrants(tx, order.id, 'refund');
    if (revoked) return { outcome: 'applied', afterCommit: await accessEmail(tx, order, 'revoked') };
  }
  return { outcome: 'applied' };
}

/** Queues an access-change email in the same transaction; the caller sends it after commit. */
async function accessEmail(tx: Tx, order: OrderRow, outcome: 'revoked' | 'restored' | 'suspended') {
  const { rows: owner } = await tx.query<{ email_normalized: string; shop_name: string }>(
    `SELECT c.email_normalized, s.shop_name FROM customers c, shop_settings s WHERE c.id = $1 AND s.id = 1`,
    [order.customer_id],
  );
  const title = await productTitle(tx, order.id);
  const row = await enqueue(tx, {
    dedupeKey: `access-${outcome}:${order.id}`,
    recipient: owner[0].email_normalized,
    template: `access_${outcome}`,
    payload: { orderId: order.id, productTitle: title },
  });
  if (!row) return undefined;
  return {
    id: row.id,
    message: accessChangedMessage({ to: owner[0].email_normalized, shopName: owner[0].shop_name, productTitle: title, outcome, idempotencyKey: row.id }),
  };
}

/**
 * Open dispute: suspend access. Closed won: restore unless the order was refunded. Closed lost: revoke.
 * A dispute object already reporting won/lost is treated as its closing event.
 */
export async function applyDispute(tx: Tx, type: string, dispute: Record<string, unknown>): Promise<RefundApplied> {
  const order = await lockOrder(tx, str(dispute.payment_intent));
  const disputeStatus = str(dispute.status);
  if (type === 'charge.dispute.created') {
    if (disputeStatus === 'won' || disputeStatus === 'lost') return { outcome: 'ignored' };
    if (order.status === 'refunded') return { outcome: 'ignored' };
    await tx.query(`UPDATE orders SET status = 'disputed' WHERE id = $1`, [order.id]);
    await setGrantsForOrder(tx, order.id, 'active', 'suspended');
    await audit(tx, { actor: 'system:stripe', action: 'dispute.opened', subjectType: 'order', subjectId: order.id, details: { disputeStatus } });
    return { outcome: 'applied', afterCommit: await accessEmail(tx, order, 'suspended') };
  }
  if (type === 'charge.dispute.closed') {
    if (disputeStatus === 'won') {
      if (order.status !== 'disputed') return { outcome: 'ignored' };
      const restored = order.refunded_minor > 0 ? 'partially_refunded' : 'paid';
      await tx.query('UPDATE orders SET status = $2 WHERE id = $1', [order.id, restored]);
      await setGrantsForOrder(tx, order.id, 'suspended', 'active');
      await audit(tx, { actor: 'system:stripe', action: 'dispute.won', subjectType: 'order', subjectId: order.id, details: {} });
      return { outcome: 'applied', afterCommit: await accessEmail(tx, order, 'restored') };
    }
    if (disputeStatus === 'lost') {
      await tx.query(`UPDATE orders SET status = 'refunded', refunded_minor = amount_minor WHERE id = $1`, [order.id]);
      const revoked = await revokeOrderGrants(tx, order.id, 'dispute_lost');
      await audit(tx, { actor: 'system:stripe', action: 'dispute.lost', subjectType: 'order', subjectId: order.id, details: {} });
      return { outcome: 'applied', afterCommit: revoked ? await accessEmail(tx, order, 'revoked') : undefined };
    }
  }
  return { outcome: 'ignored' };
}
