import type { Db } from '../core/db.js';
import { withTransaction, isUniqueViolation } from '../core/db.js';
import { apiErrors } from '../core/errors.js';
import type { Deps } from '../core/deps.js';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../auth/session.js';
import { assertLaunchReady } from './readiness.js';

export interface CheckoutStart {
  attemptId: string;
  url: string;
}

interface SellableProduct {
  id: string;
  title: string;
  price_minor: number;
  version_id: string;
  version_no: number;
}

/** Field-level conflict so clients can tell a reused key from a not-ready shop without parsing messages. */
const keyReused = () =>
  apiErrors.conflict('This checkout key was already used for a different purchase.', [{ path: 'Idempotency-Key', message: 'key_reused' }]);

/** Looks up the published product and its immutable version. Prices come only from the database. */
export async function findSellableProduct(db: Db, slug: string): Promise<SellableProduct | null> {
  const { rows } = await db.query<SellableProduct>(
    `SELECT p.id, p.title, p.price_minor, pv.id AS version_id, pv.version_no
       FROM products p
       JOIN product_versions pv ON pv.product_id = p.id AND pv.version_no = p.published_version
      WHERE p.slug = $1 AND p.status = 'published' AND p.product_type IN ('course','download')`,
    [slug],
  );
  return rows[0] ?? null;
}

/**
 * Creates a pending checkout attempt with a server-owned price snapshot, then a Stripe Checkout Session with an
 * idempotency key derived from the client's key. A retry with the same key returns the same session.
 */
export async function startCheckout(
  deps: Deps,
  input: { slug: string; email: string; idempotencyKey: string; origin: string },
): Promise<CheckoutStart> {
  const db = deps.db();
  await assertLaunchReady(db);
  const product = await findSellableProduct(db, input.slug);
  if (!product) throw apiErrors.notFound('This product is not available for purchase.');
  if (product.price_minor <= 0) {
    throw apiErrors.validation([{ path: 'slug', message: 'Free products are claimed, not purchased. Use the free claim flow.' }]);
  }
  const currencyRows = await db.query<{ currency: string }>('SELECT currency FROM shop_settings WHERE id = 1');
  const currency = currencyRows.rows[0].currency;
  // Store only a hash of the client's key; a reused key for a different product or email is refused below.
  const idemHash = sha256(`checkout:${input.idempotencyKey}`).toString('hex');

  const existing = await db.query<{ id: string; product_id: string; email_normalized: string; provider_session_id: string | null; expires_at: Date }>(
    'SELECT id, product_id, email_normalized, provider_session_id, expires_at FROM checkout_attempts WHERE idempotency_key = $1',
    [idemHash],
  );
  let attemptId: string;
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.product_id !== product.id || row.email_normalized !== input.email) {
      throw keyReused();
    }
    attemptId = row.id;
  } else {
    attemptId = randomUUID();
    try {
      await withTransaction(db, async (tx) => {
        await tx.query(
          `INSERT INTO checkout_attempts (id, product_id, product_version_id, email_normalized, idempotency_key, amount_minor, currency, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '31 minutes')`,
          [attemptId, product.id, product.version_id, input.email, idemHash, product.price_minor, currency],
        );
      });
    } catch (error) {
      // A concurrent request with the same key won the race: adopt its attempt instead of failing.
      if (!isUniqueViolation(error)) throw error;
      const winner = await db.query<{ id: string; product_id: string; email_normalized: string }>(
        'SELECT id, product_id, email_normalized FROM checkout_attempts WHERE idempotency_key = $1',
        [idemHash],
      );
      const row = winner.rows[0];
      if (!row || row.product_id !== product.id || row.email_normalized !== input.email) {
        throw keyReused();
      }
      attemptId = row.id;
    }
  }

  // Stripe requires a Checkout Session to expire at least 30 minutes after creation.
  const expiresAtUnix = Math.floor(deps.now().getTime() / 1000) + 31 * 60;
  let session: { id: string; url: string };
  try {
    session = await deps.payments().createCheckoutSession(
      {
        attemptId,
        email: input.email,
        currency,
        unitAmountMinor: product.price_minor,
        productName: product.title,
        successUrl: `${input.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${input.origin}/products/${input.slug}?checkout=cancelled`,
        expiresAtUnix,
      },
      `checkout:${idemHash}`,
    );
  } catch (error) {
    await db.query(`UPDATE checkout_attempts SET status = 'failed' WHERE id = $1 AND status = 'pending'`, [attemptId]);
    throw error;
  }
  await db.query('UPDATE checkout_attempts SET provider_session_id = $2 WHERE id = $1 AND provider_session_id IS NULL', [attemptId, session.id]);
  return { attemptId, url: session.url };
}

/** The return page only observes state. It never grants access. */
export async function checkoutStatus(db: Db, sessionId: string): Promise<{ status: 'pending' | 'paid' | 'failed' | 'expired' }> {
  const { rows } = await db.query<{ status: string; has_order: boolean }>(
    `SELECT ca.status, EXISTS (SELECT 1 FROM orders o WHERE o.checkout_attempt_id = ca.id) AS has_order
       FROM checkout_attempts ca WHERE ca.provider_session_id = $1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) throw apiErrors.notFound();
  if (row.has_order) return { status: 'paid' };
  if (row.status === 'failed') return { status: 'failed' };
  if (row.status === 'expired') return { status: 'expired' };
  return { status: 'pending' };
}
