import { createHash } from 'node:crypto';
import { withTransaction, type Db } from '../core/db.js';
import { apiErrors } from '../core/errors.js';
import type { Deps } from '../core/deps.js';
import type { Logger } from '../core/logger.js';
import { randomToken, sha256 } from '../auth/session.js';
import { createSession } from '../auth/session.js';
import { audit } from './audit.js';
import { consumeRateLimit } from './rate-limit.js';
import { deliver, enqueue } from './outbox.js';
import { loginLinkMessage } from './templates.js';

export const LINK_TTL_MINUTES = 15;
const PER_EMAIL = { limit: 5, windowSeconds: 15 * 60 };
const PER_SOURCE = { limit: 30, windowSeconds: 15 * 60 };

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Issues a single-use sign-in link. The response never reveals whether the address has an account.
 * Only the token hash is stored; the outbox row contains no token.
 */
export async function requestLoginLink(
  deps: Deps,
  log: Logger,
  input: { email: string; returnTo: string; source: string },
): Promise<void> {
  const db = deps.db();
  const perEmail = await consumeRateLimit(db, `login:email:${digest(input.email)}`, PER_EMAIL.limit, PER_EMAIL.windowSeconds);
  if (!perEmail.allowed) throw apiErrors.rateLimited(perEmail.retryAfterSeconds);
  const perSource = await consumeRateLimit(db, `login:source:${digest(input.source)}`, PER_SOURCE.limit, PER_SOURCE.windowSeconds);
  if (!perSource.allowed) throw apiErrors.rateLimited(perSource.retryAfterSeconds);

  const origin = deps.config.appOrigin;
  if (!origin) throw apiErrors.unavailable('Sign-in is not configured for this installation.');

  const token = randomToken(32);
  const tokenHash = sha256(token);
  const expiresAt = new Date(deps.now().getTime() + LINK_TTL_MINUTES * 60_000);
  const outbox = await withTransaction(db, async (tx) => {
    await tx.query(
      `INSERT INTO login_tokens (token_hash, email_normalized, return_path, expires_at) VALUES ($1, $2, $3, $4)`,
      [tokenHash, input.email, input.returnTo, expiresAt],
    );
    return enqueue(tx, {
      dedupeKey: `login:${tokenHash.toString('hex')}`,
      recipient: input.email,
      template: 'login_link',
      payload: { returnTo: input.returnTo },
    });
  });
  if (!outbox) return;
  const shopName = String((await db.query<{ shop_name: string }>('SELECT shop_name FROM shop_settings WHERE id = 1')).rows[0]?.shop_name ?? 'this shop');
  const message = loginLinkMessage({
    to: input.email,
    link: `${origin}/account/confirm?token=${encodeURIComponent(token)}`,
    shopName,
    expiresMinutes: LINK_TTL_MINUTES,
    idempotencyKey: outbox.id,
  });
  const status = await deliver(db, deps.mail, { id: outbox.id, message });
  log.info('login_link_delivery', { status });
}

/** Consumes a sign-in token exactly once and opens a session. Call only from the explicit POST. */
export async function confirmLoginLink(
  deps: Deps,
  token: string,
): Promise<{ sessionToken: string; maxAgeSeconds: number; returnTo: string; customerId: string }> {
  const tokenHash = sha256(token);
  return withTransaction(deps.db(), async (tx) => {
    const { rows } = await tx.query<{ email_normalized: string; return_path: string; valid: boolean }>(
      `SELECT email_normalized, return_path, (consumed_at IS NULL AND expires_at > now()) AS valid
         FROM login_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row || !row.valid) {
      throw apiErrors.unauthorized('This sign-in link is no longer valid. Request a new one.');
    }
    await tx.query('UPDATE login_tokens SET consumed_at = now() WHERE token_hash = $1', [tokenHash]);
    const { rows: customers } = await tx.query<{ id: string }>(
      `INSERT INTO customers (id, email_normalized) VALUES (gen_random_uuid(), $1)
       ON CONFLICT (email_normalized) DO UPDATE SET email_normalized = EXCLUDED.email_normalized
       RETURNING id`,
      [row.email_normalized],
    );
    const customerId = customers[0].id;
    const session = await createSession(tx, customerId);
    await audit(tx, { actor: `customer:${customerId}`, action: 'customer.signed_in', subjectType: 'customer', subjectId: customerId });
    return { sessionToken: session.token, maxAgeSeconds: session.maxAgeSeconds, returnTo: row.return_path, customerId };
  });
}

export type { Db };
