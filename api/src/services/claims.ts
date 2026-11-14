import { createHash } from 'node:crypto';
import { withTransaction } from '../core/db.js';
import { apiErrors } from '../core/errors.js';
import type { Deps } from '../core/deps.js';
import type { Logger } from '../core/logger.js';
import { randomToken, sha256 } from '../auth/session.js';
import { audit } from './audit.js';
import { consumeRateLimit } from './rate-limit.js';
import { deliver, enqueue } from './outbox.js';
import { recomputeEntitlement } from './entitlements.js';
import { freeClaimMessage } from './templates.js';

const CLAIM_TTL_MINUTES = 15;
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Starts a verified free claim. Responds the same whether or not the address or product is eligible. */
export async function requestFreeClaim(deps: Deps, log: Logger, input: { slug: string; email: string; source: string }): Promise<void> {
  const db = deps.db();
  const perEmail = await consumeRateLimit(db, `claim:email:${digest(input.email)}`, 5, 15 * 60);
  if (!perEmail.allowed) throw apiErrors.rateLimited(perEmail.retryAfterSeconds);
  const perSource = await consumeRateLimit(db, `claim:source:${digest(input.source)}`, 30, 15 * 60);
  if (!perSource.allowed) throw apiErrors.rateLimited(perSource.retryAfterSeconds);

  const { rows } = await db.query<{ id: string; title: string; price_minor: number }>(
    `SELECT id, title, price_minor FROM products WHERE slug = $1 AND status = 'published'`,
    [input.slug],
  );
  const product = rows[0];
  if (!product || product.price_minor !== 0) return; // Same visible response; nothing is sent for paid or unknown products.

  const origin = deps.config.appOrigin;
  if (!origin) throw apiErrors.unavailable('Claims are not configured for this installation.');
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const outbox = await withTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO free_claim_tokens (token_hash, product_id, email_normalized, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
      [tokenHash, product.id, input.email, CLAIM_TTL_MINUTES],
    );
    return enqueue(tx, { dedupeKey: `claim:${tokenHash.toString('hex')}`, recipient: input.email, template: 'free_claim', payload: { productId: product.id } });
  });
  if (!outbox) return;
  const shopName = String((await db.query<{ shop_name: string }>('SELECT shop_name FROM shop_settings WHERE id = 1')).rows[0]?.shop_name ?? 'this shop');
  const message = freeClaimMessage({
    to: input.email,
    shopName,
    productTitle: product.title,
    link: `${origin}/account/claim?token=${encodeURIComponent(token)}`,
    expiresMinutes: CLAIM_TTL_MINUTES,
    idempotencyKey: outbox.id,
  });
  log.info('free_claim_delivery', { status: await deliver(db, deps.mail, { id: outbox.id, message }) });
}

/** Confirms a free claim exactly once. Repeats are reported as already claimed, never as a second grant. */
export async function confirmFreeClaim(deps: Deps, token: string): Promise<{ productSlug: string; alreadyClaimed: boolean }> {
  const tokenHash = sha256(token);
  return withTransaction(deps.db(), async (tx) => {
    const { rows } = await tx.query<{ product_id: string; email_normalized: string; valid: boolean; slug: string; price_minor: number }>(
      `SELECT t.product_id, t.email_normalized, (t.consumed_at IS NULL AND t.expires_at > now()) AS valid, p.slug, p.price_minor
         FROM free_claim_tokens t JOIN products p ON p.id = t.product_id
        WHERE t.token_hash = $1 FOR UPDATE OF t`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row || !row.valid) throw apiErrors.unauthorized('This claim link is no longer valid. Request a new one.');
    if (row.price_minor !== 0) throw apiErrors.conflict('This product is no longer free.');
    await tx.query('UPDATE free_claim_tokens SET consumed_at = now() WHERE token_hash = $1', [tokenHash]);
    const customer = await tx.query<{ id: string }>(
      `INSERT INTO customers (id, email_normalized) VALUES (gen_random_uuid(), $1)
       ON CONFLICT (email_normalized) DO UPDATE SET email_normalized = EXCLUDED.email_normalized RETURNING id`,
      [row.email_normalized],
    );
    const customerId = customer.rows[0].id;
    const granted = await tx.query(
      `INSERT INTO entitlement_grants (id, customer_id, product_id, source)
       VALUES (gen_random_uuid(), $1, $2, 'free_claim')
       ON CONFLICT (customer_id, product_id) WHERE source = 'free_claim' DO NOTHING RETURNING id`,
      [customerId, row.product_id],
    );
    if (granted.rowCount) await recomputeEntitlement(tx, customerId, row.product_id);
    await audit(tx, { actor: `customer:${customerId}`, action: granted.rowCount ? 'free_claim.granted' : 'free_claim.repeated', subjectType: 'product', subjectId: row.product_id });
    return { productSlug: row.slug, alreadyClaimed: granted.rowCount === 0 };
  });
}
