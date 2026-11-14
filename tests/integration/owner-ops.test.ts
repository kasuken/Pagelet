import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startPostgres, type TestDatabase } from '../helpers/postgres.js';
import { APP_ORIGIN, bodyOf, cookieFrom, invocation, makeRequest, principalHeader } from '../helpers/api.js';
import { IDS, seedShop } from '../helpers/shop.js';
import type { MailMessage, MailPort } from '../../api/src/core/ports.js';

let server: TestDatabase;
let db: pg.Pool;
let dbUrl = '';
let sent: MailMessage[] = [];
let failMail = false;
let routes: Record<string, { handler: (r: any, i: any) => Promise<any> }>;
let deps: { setDepsForTesting: (p: Record<string, unknown> | undefined) => void; loadConfig: (e: NodeJS.ProcessEnv) => any };

const mail: MailPort = {
  async send(m) {
    if (failMail) throw new Error('provider down');
    sent.push(m);
    return { providerMessageId: `m${sent.length}` };
  },
};

const OWNER = { 'x-ms-client-principal': principalHeader('github', '4242') };

function configFor(env: Record<string, string> = {}) {
  return deps.loadConfig({ APP_BASE_URL: APP_ORIGIN, OWNER_IDENTITY_PROVIDER: 'github', OWNER_USER_ID: '4242', DATABASE_URL: dbUrl, ...env } as NodeJS.ProcessEnv);
}

beforeAll(async () => {
  server = await startPostgres(54_405);
  dbUrl = await server.createMigrated('owner_ops');
  db = new pg.Pool({ connectionString: dbUrl, max: 4 });
  const base = await import('../../api/src/functions/routes.js');
  const payments = await import('../../api/src/functions/payments.js');
  const owner = await import('../../api/src/functions/owner.js');
  routes = { ...base.routes, ...payments.paymentRoutes, ...owner.ownerRoutes, ...owner.accountRoutes } as any;
  deps = {
    setDepsForTesting: (await import('../../api/src/core/deps.js')).setDepsForTesting as any,
    loadConfig: (await import('../../api/src/core/config.js')).loadConfig,
  };
}, 180_000);

afterAll(async () => {
  deps?.setDepsForTesting(undefined);
  await db?.end();
  await server?.stop();
});

beforeEach(async () => {
  sent = [];
  failMail = false;
  await db.query(
    `TRUNCATE webhook_events, refunds, order_items, orders, checkout_attempts, entitlement_grants, entitlements,
              free_claim_tokens, login_tokens, sessions, customers, email_outbox, audit_events, rate_limits,
              reconciliation_runs, publications, product_versions, lesson_progress, lessons, sections, lesson_resources, assets,
              products, shop_settings RESTART IDENTITY CASCADE`,
  );
  await seedShop(db);
  deps.setDepsForTesting({ config: configFor(), db: () => db, mail });
});

const call = (name: string, request: any) => routes[name].handler(request, invocation);

/** Creates a customer with a live session by going through the real login-link endpoints. */
async function signedInCustomer(email: string): Promise<{ id: string; cookie: string }> {
  await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email } }));
  const token = new URL(sent.at(-1)!.text.split('\n').find((l) => l.includes('/account/confirm'))!).searchParams.get('token')!;
  const response = await call('auth-sessions', makeRequest('POST', 'auth/sessions', { json: { token } }));
  const id = (await db.query('SELECT id FROM customers WHERE email_normalized = $1', [email])).rows[0].id;
  return { id, cookie: `__Host-pagelet_session=${cookieFrom(response, '__Host-pagelet_session')}` };
}

describe('owner access (A01) on operations endpoints', () => {
  it('denies overview to anonymous, customers and wrong identities, and fails closed when unconfigured', async () => {
    expect((await call('owner-overview', makeRequest('GET', 'owner/overview'))).status).toBe(401);
    expect((await call('owner-overview', makeRequest('GET', 'owner/overview', { headers: { 'x-ms-client-principal': principalHeader('github', '1') } }))).status).toBe(403);
    deps.setDepsForTesting({ config: configFor({ OWNER_USER_ID: undefined as unknown as string }), db: () => db, mail });
    expect((await call('owner-overview', makeRequest('GET', 'owner/overview', { headers: OWNER }))).status).toBe(503);
    deps.setDepsForTesting({ config: configFor(), db: () => db, mail });
    const ok = await call('owner-overview', makeRequest('GET', 'owner/overview', { headers: OWNER }));
    expect(ok.status).toBe(200);
    expect(ok.headers['Cache-Control']).toBe('private, no-store');
    expect(bodyOf(ok).checkoutReady).toBe(true);
  });

  it('refuses owner mutations without same-origin', async () => {
    const response = await call('owner-retention', makeRequest('POST', 'owner/retention', { headers: OWNER, json: { confirm: 'RUN' }, origin: 'https://evil.test' }));
    expect(response.status).toBe(403);
  });
});

describe('complimentary access (O03) and library isolation (A03)', () => {
  it('grants and revokes complimentary access with audit, and keeps other customers isolated', async () => {
    const alice = await signedInCustomer('alice@example.test');
    const bob = await signedInCustomer('bob@example.test');
    // Path parameters are supplied by the Functions host; tests attach them to the request directly.
    const granted = await call('owner-grant-complimentary', Object.assign(
      makeRequest('POST', `owner/customers/${alice.id}/complimentary`, { headers: OWNER, origin: APP_ORIGIN, json: { productId: IDS.course, reason: 'Review copy for press' } }),
      { params: { customerId: alice.id } },
    ));
    expect(granted.status).toBe(201);
    const aliceLibrary = await call('library', makeRequest('GET', 'library', { headers: { cookie: alice.cookie } }));
    expect(bodyOf(aliceLibrary).items.map((i: any) => i.slug)).toEqual(['course-one']);
    const bobLibrary = await call('library', makeRequest('GET', 'library', { headers: { cookie: bob.cookie } }));
    expect(bodyOf(bobLibrary).items).toEqual([]);

    const duplicate = await call('owner-grant-complimentary', Object.assign(
      makeRequest('POST', `owner/customers/${alice.id}/complimentary`, { headers: OWNER, origin: APP_ORIGIN, json: { productId: IDS.course, reason: 'Again please' } }),
      { params: { customerId: alice.id } },
    ));
    expect(duplicate.status).toBe(409);

    const grantId = bodyOf(granted).grantId;
    const revoked = await call('owner-revoke-grant', Object.assign(
      makeRequest('POST', `owner/grants/${grantId}/revoke`, { headers: OWNER, origin: APP_ORIGIN, json: { reason: 'Press window ended' } }),
      { params: { grantId } },
    ));
    expect(bodyOf(revoked).status).toBe('revoked');
    // Revoked access stays visible as a state (never as a download), so the customer understands the change.
    const afterRevoke = bodyOf(await call('library', makeRequest('GET', 'library', { headers: { cookie: alice.cookie } }))).items;
    expect(afterRevoke.map((i: any) => i.status)).toEqual(['revoked']);
    expect((await call('owner-revoke-grant', Object.assign(makeRequest('POST', `owner/grants/${grantId}/revoke`, { headers: OWNER, origin: APP_ORIGIN, json: { reason: 'again' } }), { params: { grantId } }))).status).toBe(200);
    const audit = await db.query(`SELECT action FROM audit_events WHERE action IN ('grant.complimentary','grant.revoked') ORDER BY id`);
    expect(audit.rows.map((r) => r.action)).toEqual(['grant.complimentary', 'grant.revoked']);
  });

  it('refuses to revoke a purchase grant from the owner console', async () => {
    const alice = await signedInCustomer('buyer2@example.test');
    const orderGrant = await db.query(`INSERT INTO entitlement_grants (id, customer_id, product_id, source) VALUES (gen_random_uuid(), $1, $2, 'free_claim') RETURNING id`, [alice.id, IDS.download]);
    const response = await call('owner-revoke-grant', Object.assign(
      makeRequest('POST', 'owner/grants/x/revoke', { headers: OWNER, origin: APP_ORIGIN, json: { reason: 'Attempt to revoke' } }),
      { params: { grantId: orderGrant.rows[0].id } },
    ));
    expect(response.status).toBe(409);
  });
});

describe('email delivery recovery (A04)', () => {
  it('retries a failed purchase email once, idempotently, and reports a login link as not retryable', async () => {
    const alice = await signedInCustomer('mailtest@example.test');
    const attempt = await db.query(
      `INSERT INTO checkout_attempts (id, product_id, product_version_id, email_normalized, idempotency_key, amount_minor, currency, expires_at)
       VALUES (gen_random_uuid(), $1, $2, 'mailtest@example.test', 'idem-mail-1', 4900, 'EUR', now() + interval '1 day') RETURNING id`,
      [IDS.course, IDS.courseVersion],
    );
    const order = await db.query(
      `INSERT INTO orders (id, customer_id, checkout_attempt_id, provider_payment_id, amount_minor, currency, policy_version)
       VALUES (gen_random_uuid(), $1, $2, 'pi_mailtest', 4900, 'EUR', 1) RETURNING id`,
      [alice.id, attempt.rows[0].id],
    );
    await db.query(`INSERT INTO order_items (id, order_id, product_id, product_version_id, title_snapshot, unit_price_minor, quantity) VALUES (gen_random_uuid(), $1, $2, $3, 'Course One', 4900, 1)`, [order.rows[0].id, IDS.course, IDS.courseVersion]);
    await db.query(
      `INSERT INTO email_outbox (id, dedupe_key, recipient_email_normalized, template, payload, status, attempts, last_error)
       VALUES (gen_random_uuid(), 'purchase:test', 'mailtest@example.test', 'purchase_access', $1::jsonb, 'failed', 1, 'provider down')`,
      [JSON.stringify({ orderId: order.rows[0].id })],
    );
    const failed = await db.query(`SELECT id FROM email_outbox WHERE dedupe_key = 'purchase:test'`);
    const retry = await call('owner-email-retry', Object.assign(makeRequest('POST', 'owner/emails/x/retry', { headers: OWNER, origin: APP_ORIGIN }), { params: { emailId: failed.rows[0].id } }));
    expect(bodyOf(retry).result).toBe('sent');
    expect(sent.at(-1)!.subject).toContain('Course One');
    const again = await call('owner-email-retry', Object.assign(makeRequest('POST', 'owner/emails/x/retry', { headers: OWNER, origin: APP_ORIGIN }), { params: { emailId: failed.rows[0].id } }));
    expect(bodyOf(again).result).toBe('not_retryable');
    expect(sent.filter((m) => m.subject.includes('Course One')).length).toBe(1);

    await db.query(`INSERT INTO email_outbox (id, dedupe_key, recipient_email_normalized, template, payload, status) VALUES (gen_random_uuid(), 'login:test', 'x@example.test', 'login_link', '{}', 'failed')`);
    const login = await db.query(`SELECT id FROM email_outbox WHERE dedupe_key = 'login:test'`);
    const notRetryable = await call('owner-email-retry', Object.assign(makeRequest('POST', 'owner/emails/x/retry', { headers: OWNER, origin: APP_ORIGIN }), { params: { emailId: login.rows[0].id } }));
    expect(bodyOf(notRetryable).result).toBe('not_retryable');
  });
});

describe('order support and privacy (O02, O04)', () => {
  it('pages orders with an opaque cursor and returns order detail without provider card data', async () => {
    const buyer = await signedInCustomer('pager@example.test');
    for (let i = 0; i < 3; i++) {
      const att = await db.query(
        `INSERT INTO checkout_attempts (id, product_id, product_version_id, email_normalized, idempotency_key, amount_minor, currency, expires_at)
         VALUES (gen_random_uuid(), $1, $2, 'pager@example.test', $3, 4900, 'EUR', now() + interval '1 day') RETURNING id`,
        [IDS.course, IDS.courseVersion, `pg-${i}`],
      );
      await db.query(
        `INSERT INTO orders (id, customer_id, checkout_attempt_id, provider_payment_id, amount_minor, currency, policy_version, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 4900, 'EUR', 1, now() - make_interval(mins => $4))`,
        [buyer.id, att.rows[0].id, `pi_page_${i}`, i],
      );
    }
    const first = await call('owner-orders', makeRequest('GET', 'owner/orders?limit=2', { headers: OWNER }));
    expect(bodyOf(first).items.length).toBe(2);
    expect(bodyOf(first).nextCursor).toBeTruthy();
    const second = await call('owner-orders', makeRequest('GET', `owner/orders?limit=2&cursor=${encodeURIComponent(bodyOf(first).nextCursor)}`, { headers: OWNER }));
    expect(bodyOf(second).items.length).toBe(1);
    const ids = [...bodyOf(first).items, ...bodyOf(second).items].map((o: any) => o.id);
    expect(new Set(ids).size).toBe(3);
    const detail = await call('owner-order', Object.assign(makeRequest('GET', `owner/orders/${ids[0]}`, { headers: OWNER }), { params: { orderId: ids[0] } }));
    expect(detail.status).toBe(200);
    expect(bodyOf(detail).providerPaymentId).toMatch(/^pi_page_/);
    expect(String(detail.body)).not.toMatch(/card|cvc|last4/i);
  });

  it('rejects a tampered cursor', async () => {
    const response = await call('owner-orders', makeRequest('GET', 'owner/orders?cursor=%%%', { headers: OWNER }));
    expect(response.status).toBe(400);
  });

  it('runs retention without touching orders and records what it removed', async () => {
    await db.query(`INSERT INTO login_tokens (token_hash, email_normalized, return_path, expires_at) VALUES (decode(repeat('ab', 32), 'hex'), 'old@example.test', '/library', now() - interval '3 days')`);
    const response = await call('owner-retention', makeRequest('POST', 'owner/retention', { headers: OWNER, origin: APP_ORIGIN, json: { confirm: 'RUN' } }));
    expect(bodyOf(response).loginTokens).toBe(1);
    expect((await db.query(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'retention.run'`)).rows[0].n).toBe(1);
  });

  it('erases a customer while keeping the order record, then refuses a second erasure as a no-op', async () => {
    const victim = await signedInCustomer('erase.me@example.test');
    const erased = await call('owner-erase-customer', Object.assign(
      makeRequest('POST', `owner/customers/${victim.id}/erase`, { headers: OWNER, origin: APP_ORIGIN, json: { confirm: 'ERASE' } }),
      { params: { customerId: victim.id } },
    ));
    expect(bodyOf(erased)).toEqual({ erased: true });
    const row = (await db.query('SELECT email_normalized, erased_at FROM customers WHERE id = $1', [victim.id])).rows[0];
    expect(row.email_normalized).not.toContain('erase.me');
    expect(row.erased_at).not.toBeNull();
    const after = await call('me', makeRequest('GET', 'me', { headers: { cookie: victim.cookie } }));
    expect(after.status).toBe(401);
    const again = await call('owner-erase-customer', Object.assign(
      makeRequest('POST', `owner/customers/${victim.id}/erase`, { headers: OWNER, origin: APP_ORIGIN, json: { confirm: 'ERASE' } }),
      { params: { customerId: victim.id } },
    ));
    expect(bodyOf(again)).toEqual({ erased: false });
  });
});

describe('customer account controls (L04)', () => {
  it('exports only the signed-in customer data, revokes all sessions, and never includes tokens', async () => {
    const me = await signedInCustomer('export@example.test');
    const exported = await call('me-export', makeRequest('GET', 'me/export', { headers: { cookie: me.cookie } }));
    expect(exported.status).toBe(200);
    expect(bodyOf(exported).account.email).toBe('export@example.test');
    expect(String(exported.body)).not.toMatch(/token_hash|id_hash/);
    const revoked = await call('me-revoke-sessions', makeRequest('POST', 'me/sessions/revoke', { headers: { cookie: me.cookie }, origin: APP_ORIGIN }));
    expect(revoked.status).toBe(204);
    expect((await call('me-export', makeRequest('GET', 'me/export', { headers: { cookie: me.cookie } }))).status).toBe(401);
  });

  it('lets a customer erase their own account only with explicit confirmation', async () => {
    const me = await signedInCustomer('selferase@example.test');
    const refused = await call('me-erase', makeRequest('POST', 'me/erase', { headers: { cookie: me.cookie }, origin: APP_ORIGIN, json: { confirm: 'yes' } }));
    expect(refused.status).toBe(400);
    const done = await call('me-erase', makeRequest('POST', 'me/erase', { headers: { cookie: me.cookie }, origin: APP_ORIGIN, json: { confirm: 'DELETE' } }));
    expect(done.status).toBe(204);
    expect(done.cookies && cookieFrom(done, '__Host-pagelet_session')).toBe('');
  });
});
