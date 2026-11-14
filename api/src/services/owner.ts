import { randomUUID } from 'node:crypto';
import type { Db, Tx } from '../core/db.js';
import { withTransaction } from '../core/db.js';
import { apiErrors } from '../core/errors.js';
import type { Deps } from '../core/deps.js';
import { audit } from './audit.js';
import { enqueue, deliver } from './outbox.js';
import { recomputeEntitlement } from './entitlements.js';
import { missingLaunchRequirements } from './readiness.js';
import { accessChangedMessage, purchaseAccessMessage } from './templates.js';
import type { MailMessage } from '../core/ports.js';

const CURSOR_LIMIT = 50;

/** Opaque, tamper-evident-enough keyset cursor: base64url of {t: ISO time, id}. */
export function encodeCursor(time: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: time.toISOString(), id })).toString('base64url');
}
export function decodeCursor(cursor: string | undefined): { t: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed.t === 'string' && typeof parsed.id === 'string') return parsed;
  } catch {
    /* fall through */
  }
  throw apiErrors.validation([{ path: 'cursor', message: 'The cursor is not valid.' }]);
}

export async function overview(db: Db) {
  const [sales, counts, disputes, webhooks, emails, missing] = await Promise.all([
    db.query<{ count: number; gross: string; currency: string | null }>(
      `SELECT count(*)::int AS count, COALESCE(sum(amount_minor),0)::text AS gross, max(currency) AS currency
         FROM orders WHERE created_at > now() - interval '30 days'`,
    ),
    db.query<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM products GROUP BY status'),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM orders WHERE status = 'disputed'`),
    db.query<{ n: number }>(`SELECT count(*)::int AS n FROM webhook_events WHERE status = 'failed'`),
    db.query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM email_outbox WHERE status <> 'sent' GROUP BY status`),
    missingLaunchRequirements(db),
  ]);
  const s = sales.rows[0];
  return {
    salesLast30Days: { count: s.count, grossMinor: Number(s.gross), currency: s.currency },
    products: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    openDisputes: disputes.rows[0].n,
    failedWebhooks: webhooks.rows[0].n,
    emails: Object.fromEntries(emails.rows.map((r) => [r.status, r.n])),
    checkoutReady: missing.length === 0,
    missingLaunchRequirements: missing,
  };
}

export async function listOrders(db: Db, input: { cursor?: string; limit?: number; status?: string }) {
  const after = decodeCursor(input.cursor);
  const limit = Math.min(input.limit ?? CURSOR_LIMIT, CURSOR_LIMIT);
  const { rows } = await db.query(
    `SELECT o.id, o.created_at, o.status, o.amount_minor, o.refunded_minor, o.currency, c.email_normalized,
            (SELECT string_agg(oi.title_snapshot, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS titles
       FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE ($1::text IS NULL OR o.status = $1)
        AND ($2::timestamptz IS NULL OR (o.created_at, o.id) < ($2::timestamptz, $3::uuid))
      ORDER BY o.created_at DESC, o.id DESC LIMIT $4`,
    [input.status ?? null, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      status: r.status,
      total: { amountMinor: r.amount_minor, currency: r.currency },
      refundedMinor: r.refunded_minor,
      customerEmail: r.email_normalized,
      titles: r.titles ?? '',
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(new Date(last.created_at), last.id) : null,
  };
}

export async function orderDetail(db: Db, orderId: string) {
  const { rows } = await db.query(
    `SELECT o.*, c.email_normalized FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) throw apiErrors.notFound();
  const [items, refunds, grants, events] = await Promise.all([
    db.query('SELECT product_id, title_snapshot, unit_price_minor FROM order_items WHERE order_id = $1', [orderId]),
    db.query('SELECT provider_refund_id, amount_minor, created_at FROM refunds WHERE order_id = $1 ORDER BY created_at', [orderId]),
    db.query('SELECT id, source, status, reason, updated_at FROM entitlement_grants WHERE order_id = $1', [orderId]),
    db.query(`SELECT action, details, created_at FROM audit_events WHERE subject_type = 'order' AND subject_id = $1 ORDER BY created_at DESC LIMIT 50`, [orderId]),
  ]);
  return {
    id: order.id,
    status: order.status,
    createdAt: new Date(order.created_at).toISOString(),
    total: { amountMinor: order.amount_minor, currency: order.currency },
    refundedMinor: order.refunded_minor,
    customerEmail: order.email_normalized,
    policyVersion: order.policy_version,
    items: items.rows.map((i) => ({ productId: i.product_id, title: i.title_snapshot, unitPriceMinor: i.unit_price_minor })),
    refunds: refunds.rows.map((r) => ({ id: r.provider_refund_id, amountMinor: r.amount_minor, createdAt: new Date(r.created_at).toISOString() })),
    grants: grants.rows,
    // Provider payment identifiers are shown for reconciliation only; never card data.
    providerPaymentId: order.provider_payment_id,
    events: events.rows.map((e) => ({ action: e.action, details: e.details, at: new Date(e.created_at).toISOString() })),
  };
}

export async function listCustomers(db: Db, query: string | undefined) {
  const term = query ? `${query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const { rows } = await db.query(
    `SELECT c.id, c.email_normalized, c.created_at, c.erased_at,
            (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id) AS orders
       FROM customers c
      WHERE ($1::text IS NULL OR c.email_normalized LIKE $1)
      ORDER BY c.created_at DESC LIMIT 50`,
    [term],
  );
  return { items: rows.map((r) => ({ id: r.id, email: r.email_normalized, orders: r.orders, erased: Boolean(r.erased_at), createdAt: new Date(r.created_at).toISOString() })) };
}

export async function customerDetail(db: Db, customerId: string) {
  const { rows } = await db.query('SELECT id, email_normalized, created_at, erased_at FROM customers WHERE id = $1', [customerId]);
  if (!rows[0]) throw apiErrors.notFound();
  const [entitlements, orders, grants] = await Promise.all([
    db.query(
      `SELECT e.product_id, p.title, e.status FROM entitlements e JOIN products p ON p.id = e.product_id WHERE e.customer_id = $1`,
      [customerId],
    ),
    db.query(
      `SELECT g.id, g.product_id, g.source, g.status, g.created_at FROM entitlement_grants g WHERE g.customer_id = $1 ORDER BY g.created_at DESC LIMIT 100`,
      [customerId],
    ),
    db.query('SELECT id, status, amount_minor, currency, created_at FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50', [customerId]),
  ]);
  return {
    id: rows[0].id,
    email: rows[0].email_normalized,
    erased: Boolean(rows[0].erased_at),
    entitlements: entitlements.rows.map((e) => ({ productId: e.product_id, title: e.title, status: e.status })),
    orders: orders.rows.map((o) => ({ id: o.id, status: o.status, total: { amountMinor: o.amount_minor, currency: o.currency }, createdAt: new Date(o.created_at).toISOString() })),
    grants: grants.rows.map((g) => ({ id: g.id, productId: g.product_id, source: g.source, status: g.status, createdAt: new Date(g.created_at).toISOString() })),
  };
}

/** Grants complimentary access. Audited; at most one active complimentary grant per customer and product. */
export async function grantComplimentary(deps: Deps, input: { customerId: string; productId: string; reason: string; actor: string }) {
  return withTransaction(deps.db(), async (tx: Tx) => {
    const product = await tx.query<{ title: string; status: string }>('SELECT title, status FROM products WHERE id = $1 FOR SHARE', [input.productId]);
    if (!product.rows[0]) throw apiErrors.notFound('Product not found.');
    if (product.rows[0].status === 'draft') throw apiErrors.conflict('Complimentary access needs a published or archived product.');
    const id = randomUUID();
    try {
      await tx.query('SAVEPOINT grant_insert');
      await tx.query(
        `INSERT INTO entitlement_grants (id, customer_id, product_id, source, reason) VALUES ($1, $2, $3, 'complimentary', $4)`,
        [id, input.customerId, input.productId, input.reason],
      );
      await tx.query('RELEASE SAVEPOINT grant_insert');
    } catch (error) {
      await tx.query('ROLLBACK TO SAVEPOINT grant_insert');
      if ((error as { code?: string }).code === '23505') throw apiErrors.conflict('This customer already has complimentary access to this product.');
      throw error;
    }
    const status = await recomputeEntitlement(tx, input.customerId, input.productId);
    await audit(tx, { actor: input.actor, action: 'grant.complimentary', subjectType: 'customer', subjectId: input.customerId, details: { productId: input.productId, reason: input.reason, grantId: id } });
    const email = await tx.query<{ email_normalized: string; shop_name: string }>(
      `SELECT c.email_normalized, s.shop_name FROM customers c, shop_settings s WHERE c.id = $1 AND s.id = 1`,
      [input.customerId],
    );
    const outbox = await enqueue(tx, { dedupeKey: `grant:${id}`, recipient: email.rows[0].email_normalized, template: 'access_restored', payload: { grantId: id } });
    const afterCommit = outbox
      ? { id: outbox.id, message: accessChangedMessage({ to: email.rows[0].email_normalized, shopName: email.rows[0].shop_name, productTitle: product.rows[0].title, outcome: 'restored', idempotencyKey: outbox.id }) }
      : undefined;
    return { grantId: id, status, afterCommit };
  }).then(async (result) => {
    if (result.afterCommit) await deliver(deps.db(), deps.mail, result.afterCommit).catch(() => undefined);
    return { grantId: result.grantId, status: result.status };
  });
}

/** Revokes a complimentary grant only. Purchase grants are changed by refunds and disputes in the payment provider. */
export async function revokeComplimentary(deps: Deps, input: { grantId: string; reason: string; actor: string }) {
  const result = await withTransaction(deps.db(), async (tx: Tx) => {
    const { rows } = await tx.query<{ customer_id: string; product_id: string; source: string; status: string; title: string; email: string }>(
      `SELECT g.customer_id, g.product_id, g.source, g.status, p.title, c.email_normalized AS email
         FROM entitlement_grants g JOIN products p ON p.id = g.product_id JOIN customers c ON c.id = g.customer_id
        WHERE g.id = $1 FOR UPDATE OF g`,
      [input.grantId],
    );
    const grant = rows[0];
    if (!grant) throw apiErrors.notFound();
    if (grant.source !== 'complimentary') throw apiErrors.conflict('Purchases are refunded in the payment provider. Only complimentary access can be revoked here.');
    if (grant.status === 'revoked') return { status: 'already_revoked' as const };
    await tx.query(`UPDATE entitlement_grants SET status = 'revoked', reason = $2, updated_at = now() WHERE id = $1`, [input.grantId, input.reason]);
    const status = await recomputeEntitlement(tx, grant.customer_id, grant.product_id);
    await audit(tx, { actor: input.actor, action: 'grant.revoked', subjectType: 'customer', subjectId: grant.customer_id, details: { productId: grant.product_id, reason: input.reason, grantId: input.grantId } });
    const shop = await tx.query<{ shop_name: string }>('SELECT shop_name FROM shop_settings WHERE id = 1');
    const outbox = await enqueue(tx, { dedupeKey: `revoke:${input.grantId}`, recipient: grant.email, template: 'access_revoked', payload: { grantId: input.grantId } });
    return {
      status: status ?? ('revoked' as const),
      afterCommit: outbox ? { id: outbox.id, message: accessChangedMessage({ to: grant.email, shopName: shop.rows[0].shop_name, productTitle: grant.title, outcome: 'revoked', idempotencyKey: outbox.id }) } : undefined,
    };
  });
  if ('afterCommit' in result && result.afterCommit) {
    await deliver(deps.db(), deps.mail, result.afterCommit as { id: string; message: MailMessage }).catch(() => undefined);
  }
  return { status: result.status };
}

export async function listEmails(db: Db, status: 'failed' | 'pending') {
  const { rows } = await db.query(
    `SELECT id, template, recipient_email_normalized, status, attempts, last_error, created_at FROM email_outbox
      WHERE status = $1 ORDER BY created_at DESC LIMIT 50`,
    [status],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      template: r.template,
      recipient: r.recipient_email_normalized,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

export async function listAudit(db: Db, input: { cursor?: string; limit?: number }) {
  const after = decodeCursor(input.cursor);
  const limit = Math.min(input.limit ?? CURSOR_LIMIT, CURSOR_LIMIT);
  const { rows } = await db.query(
    `SELECT id, actor, action, subject_type, subject_id, details, created_at FROM audit_events
      WHERE ($1::timestamptz IS NULL OR (created_at, id::text) < ($1::timestamptz, $2))
      ORDER BY created_at DESC, id DESC LIMIT $3`,
    [after?.t ?? null, after?.id ?? '', limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({ id: r.id, actor: r.actor, action: r.action, subjectType: r.subject_type, subjectId: r.subject_id, details: r.details, at: new Date(r.created_at).toISOString() })),
    nextCursor: rows.length > limit && last ? encodeCursor(new Date(last.created_at), String(last.id)) : null,
  };
}

/**
 * Retention: removes data whose purpose has ended. Financial and order records are never deleted here.
 * Windows are fixed, documented in docs/OPERATIONS.md, and reported to the owner.
 */
export async function runRetention(db: Db, actor: string) {
  return withTransaction(db, async (tx) => {
    const tokens = await tx.query(`DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day'`);
    const claims = await tx.query(`DELETE FROM free_claim_tokens WHERE expires_at < now() - interval '1 day'`);
    const sessions = await tx.query(`DELETE FROM sessions WHERE expires_at < now() - interval '1 day' OR revoked_at < now() - interval '30 days'`);
    const limits = await tx.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
    const outbox = await tx.query(`DELETE FROM email_outbox WHERE status = 'sent' AND sent_at < now() - interval '365 days'`);
    const webhooks = await tx.query(`DELETE FROM webhook_events WHERE status = 'processed' AND processed_at < now() - interval '400 days'`);
    const report = {
      loginTokens: tokens.rowCount ?? 0,
      freeClaimTokens: claims.rowCount ?? 0,
      sessions: sessions.rowCount ?? 0,
      rateLimits: limits.rowCount ?? 0,
      sentEmails: outbox.rowCount ?? 0,
      processedWebhooks: webhooks.rowCount ?? 0,
    };
    await audit(tx, { actor, action: 'retention.run', subjectType: 'installation', subjectId: 'shop', details: report });
    return report;
  });
}

/**
 * Erasure keeps the order and payment record (legal retention) but removes the customer's identifying email from
 * their account, sessions, tokens and outbox rows. The row stays so reconciliation remains consistent.
 */
export async function eraseCustomer(db: Db, customerId: string, actor: string) {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ email_normalized: string; erased_at: Date | null }>(
      'SELECT email_normalized, erased_at FROM customers WHERE id = $1 FOR UPDATE',
      [customerId],
    );
    const row = rows[0];
    if (!row) throw apiErrors.notFound();
    if (row.erased_at) return { erased: false as const };
    const placeholder = `erased+${customerId}@erased.invalid`;
    await tx.query('DELETE FROM login_tokens WHERE email_normalized = $1', [row.email_normalized]);
    await tx.query('DELETE FROM free_claim_tokens WHERE email_normalized = $1', [row.email_normalized]);
    await tx.query('UPDATE email_outbox SET recipient_email_normalized = $2, payload = $3::jsonb WHERE recipient_email_normalized = $1', [row.email_normalized, placeholder, JSON.stringify({ erased: true })]);
    await tx.query('UPDATE customers SET email_normalized = $2, erased_at = now() WHERE id = $1', [customerId, placeholder]);
    await tx.query('UPDATE sessions SET revoked_at = now() WHERE customer_id = $1 AND revoked_at IS NULL', [customerId]);
    await audit(tx, { actor, action: 'customer.erased', subjectType: 'customer', subjectId: customerId, details: {} });
    return { erased: true as const };
  });
}

/** Rebuilds the message for a failed outbox row from the database, so a retry reflects current data. */
export async function rebuildMessage(db: Db, row: { id: string; template: string; recipient_email_normalized: string; payload: Record<string, unknown> }, origin: string): Promise<MailMessage | null> {
  if (row.template === 'purchase_access') {
    const orderId = String(row.payload.orderId ?? '');
    const { rows } = await db.query<{ title: string; shop: string }>(
      `SELECT oi.title_snapshot AS title, s.shop_name AS shop FROM order_items oi, shop_settings s
        WHERE oi.order_id = $1 AND s.id = 1 LIMIT 1`,
      [orderId],
    );
    if (!rows[0]) return null;
    return purchaseAccessMessage({ to: row.recipient_email_normalized, shopName: rows[0].shop, productTitle: rows[0].title, libraryUrl: `${origin}/library`, idempotencyKey: row.id });
  }
  return null; // Login links and free-claim links contain single-use tokens that are not stored. The customer requests a new one.
}

/** Publication history for one product: queued, building, succeeded or failed, with the build link. */
export async function productPublications(db: Db, productId: string) {
  const { rows } = await db.query(
    `SELECT id, version_no, reason, status, attempts, last_error, build_url, created_at, updated_at
       FROM publications WHERE product_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [productId],
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      versionNo: r.version_no,
      reason: r.reason,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      buildUrl: r.build_url,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    })),
  };
}
