import { withTransaction, isUniqueViolation, type Db, type Tx } from '../core/db.js';
import type { Deps } from '../core/deps.js';
import type { CheckoutSessionSnapshot, VerifiedEvent } from '../core/payment-port.js';
import { deliver, enqueue } from './outbox.js';
import { audit } from './audit.js';
import { recomputeEntitlement } from './entitlements.js';
import { purchaseAccessMessage } from './templates.js';
import { applyRefund, applyDispute } from './refunds.js';
import { MismatchError, RetryableError, type HandleOutcome } from './payment-errors.js';
import type { Logger } from '../core/logger.js';
import type { MailMessage } from '../core/ports.js';

export const FULFILLMENT_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'] as const;

interface Applied {
  outcome: HandleOutcome;
  /** Email prepared inside the transaction; sent only after the commit succeeds. */
  afterCommit?: { id: string; message: MailMessage };
}

/**
 * Processes one verified Stripe event. The event row, business changes and outbox row commit together, so a
 * duplicate delivery (sequential or concurrent) cannot duplicate access or email. The caller acknowledges
 * (HTTP 200) only after this function returns.
 */
export async function handleVerifiedEvent(deps: Deps, log: Logger, event: VerifiedEvent): Promise<HandleOutcome> {
  const relevant = (FULFILLMENT_EVENTS as readonly string[]).includes(event.type) || event.type === 'refund.created' || event.type.startsWith('charge.dispute.');
  if (!relevant) {
    await recordEvent(deps.db(), event, 'ignored');
    return 'ignored';
  }
  // Authoritative state comes from the provider, never from the webhook body alone.
  let object = event.object;
  if ((FULFILLMENT_EVENTS as readonly string[]).includes(event.type)) {
    const id = typeof event.object.id === 'string' ? event.object.id : '';
    if (!id) throw new MismatchError('Event has no checkout session id.');
    object = (await deps.payments().retrieveCheckoutSession(id)) as unknown as Record<string, unknown>;
  }
  const verified: VerifiedEvent = { ...event, object };
  try {
    const applied = await withTransaction(deps.db(), async (tx): Promise<Applied> => {
      const inserted = await tx.query(
        `INSERT INTO webhook_events (provider_event_id, event_type, status) VALUES ($1, $2, 'processing')
         ON CONFLICT (provider_event_id) DO NOTHING RETURNING provider_event_id`,
        [event.id, event.type],
      );
      if (inserted.rowCount === 0) return { outcome: 'duplicate_event' };
      const result = await applyEvent(deps, tx, log, verified);
      await tx.query(`UPDATE webhook_events SET status = 'processed', processed_at = now() WHERE provider_event_id = $1`, [event.id]);
      return result;
    });
    if (applied.afterCommit) {
      await deliver(deps.db(), deps.mail, applied.afterCommit).catch(() => undefined);
    }
    return applied.outcome;
  } catch (error) {
    if (error instanceof MismatchError) {
      await recordEvent(deps.db(), event, 'failed', error.message);
      log.warn('payment_event_mismatch', { eventType: event.type, reason: error.message });
      return 'recorded_mismatch';
    }
    throw error;
  }
}

async function recordEvent(db: Db, event: VerifiedEvent, status: 'ignored' | 'failed', lastError?: string) {
  await db.query(
    `INSERT INTO webhook_events (provider_event_id, event_type, status, processed_at, last_error)
     VALUES ($1, $2, $3, now(), $4) ON CONFLICT (provider_event_id) DO NOTHING`,
    [event.id, event.type, status, lastError ?? null],
  );
}

async function applyEvent(deps: Deps, tx: Tx, log: Logger, event: VerifiedEvent): Promise<Applied> {
  if ((FULFILLMENT_EVENTS as readonly string[]).includes(event.type)) {
    return fulfillSession(deps, tx, log, event.object as unknown as CheckoutSessionSnapshot);
  }
  if (event.type === 'refund.created') return applyRefund(tx, event.object);
  if (event.type.startsWith('charge.dispute.')) return applyDispute(tx, event.type, event.object);
  return { outcome: 'ignored' };
}

/**
 * Fulfils one paid checkout session. The event object is only a pointer: the authoritative state is re-read from
 * the provider by the caller (see fulfillFromProvider) before this runs, so a forged or replayed object is not trusted.
 */
export async function fulfillSession(deps: Deps, tx: Tx, log: Logger, session: CheckoutSessionSnapshot): Promise<Applied> {
  if (session.mode !== 'payment') throw new MismatchError('Session is not a payment-mode checkout.');
  if (session.paymentStatus !== 'paid') throw new RetryableError('Payment is not complete yet.');
  if (!session.clientReferenceId) throw new MismatchError('Session has no checkout attempt reference.');
  if (!session.paymentIntentId) throw new MismatchError('Session has no payment intent.');

  const { rows: attempts } = await tx.query<{
    id: string;
    product_id: string;
    product_version_id: string;
    email_normalized: string;
    amount_minor: number;
    currency: string;
    provider_session_id: string | null;
    title: string;
  }>(
    `SELECT ca.id, ca.product_id, ca.product_version_id, ca.email_normalized, ca.amount_minor, ca.currency, ca.provider_session_id, p.title
       FROM checkout_attempts ca JOIN products p ON p.id = ca.product_id
      WHERE ca.id = $1 FOR UPDATE OF ca`,
    [session.clientReferenceId],
  );
  const attempt = attempts[0];
  if (!attempt) throw new MismatchError('Checkout attempt not found.');
  if (attempt.provider_session_id && attempt.provider_session_id !== session.id) {
    throw new MismatchError('Session does not match the stored checkout session.');
  }
  if (session.amountTotalMinor !== attempt.amount_minor || session.currency?.toUpperCase() !== attempt.currency) {
    throw new MismatchError('Paid amount or currency does not match the server-side price.');
  }

  const existing = await tx.query('SELECT id FROM orders WHERE checkout_attempt_id = $1', [attempt.id]);
  if (existing.rowCount) return { outcome: 'already_fulfilled' };

  const shop = await tx.query<{ currency: string; digital_delivery_consent_version: number; shop_name: string }>(
    'SELECT currency, digital_delivery_consent_version, shop_name FROM shop_settings WHERE id = 1',
  );
  const customer = await tx.query<{ id: string }>(
    `INSERT INTO customers (id, email_normalized) VALUES (gen_random_uuid(), $1)
     ON CONFLICT (email_normalized) DO UPDATE SET email_normalized = EXCLUDED.email_normalized RETURNING id`,
    [attempt.email_normalized],
  );
  const customerId = customer.rows[0].id;
  const orderId = (await tx.query<{ id: string }>('SELECT gen_random_uuid() AS id')).rows[0].id;
  try {
    await tx.query('SAVEPOINT order_insert');
    await tx.query(
      `INSERT INTO orders (id, customer_id, checkout_attempt_id, provider_payment_id, status, amount_minor, currency, policy_version)
       VALUES ($1, $2, $3, $4, 'paid', $5, $6, $7)`,
      [orderId, customerId, attempt.id, session.paymentIntentId, attempt.amount_minor, attempt.currency, shop.rows[0].digital_delivery_consent_version],
    );
    await tx.query('RELEASE SAVEPOINT order_insert');
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await tx.query('ROLLBACK TO SAVEPOINT order_insert');
    throw new MismatchError('Payment intent is already recorded for another order.');
  }
  await tx.query(
    `INSERT INTO order_items (id, order_id, product_id, product_version_id, title_snapshot, unit_price_minor, quantity)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1)`,
    [orderId, attempt.product_id, attempt.product_version_id, attempt.title, attempt.amount_minor],
  );
  await tx.query(
    `INSERT INTO entitlement_grants (id, customer_id, product_id, source, order_id)
     VALUES (gen_random_uuid(), $1, $2, 'purchase', $3)`,
    [customerId, attempt.product_id, orderId],
  );
  await recomputeEntitlement(tx, customerId, attempt.product_id);
  await tx.query(`UPDATE checkout_attempts SET status = 'complete' WHERE id = $1`, [attempt.id]);
  await audit(tx, { actor: 'system:stripe', action: 'order.created', subjectType: 'order', subjectId: orderId, details: { productId: attempt.product_id } });

  const outbox = await enqueue(tx, {
    dedupeKey: `purchase:${orderId}`,
    recipient: attempt.email_normalized,
    template: 'purchase_access',
    payload: { productId: attempt.product_id, orderId },
  });
  log.info('order_fulfilled', { orderId, productId: attempt.product_id });
  if (!outbox) return { outcome: 'fulfilled' };
  return {
    outcome: 'fulfilled',
    afterCommit: {
      id: outbox.id,
      message: purchaseAccessMessage({
        to: attempt.email_normalized,
        shopName: shop.rows[0].shop_name,
        productTitle: attempt.title,
        libraryUrl: `${deps.config.appOrigin ?? ''}/library`,
        idempotencyKey: outbox.id,
      }),
    },
  };
}

/** Re-reads the session from the provider (authoritative) and fulfils it. Used by webhooks and reconciliation. */
export async function fulfillFromProvider(deps: Deps, log: Logger, sessionId: string): Promise<HandleOutcome> {
  const session = await deps.payments().retrieveCheckoutSession(sessionId);
  const synthetic: VerifiedEvent = { id: `reconcile:${session.id}`, type: 'checkout.session.completed', object: session as unknown as Record<string, unknown> };
  return handleVerifiedEvent(deps, log, synthetic);
}
