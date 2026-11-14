import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import Stripe from 'stripe';
import { startPostgres, type TestDatabase } from '../helpers/postgres.js';
import { APP_ORIGIN, bodyOf, invocation, makeRequest } from '../helpers/api.js';
import { seedShop } from '../helpers/shop.js';
import type { CheckoutSessionSnapshot, PaymentPort } from '../../api/src/core/payment-port.js';
import type { MailMessage, MailPort } from '../../api/src/core/ports.js';

const WEBHOOK_SECRET = 'whsec_test_secret_for_offline_verification';
let server: TestDatabase;
let db: pg.Pool;
let dbUrl = '';
let sessions = new Map<string, CheckoutSessionSnapshot>();
let createdParams: Array<{ params: any; key: string }> = [];
/** The session ID the next fake Checkout create will return, so fixtures can refer to sessions by name. */
let nextSessionId: string | undefined;
let listPages: Array<{ data: CheckoutSessionSnapshot[]; hasMore: boolean }> = [];
let sent: MailMessage[] = [];
let routes: Record<string, { handler: (r: any, i: any) => Promise<any> }>;
let deps: { setDepsForTesting: (p: Record<string, unknown> | undefined) => void; loadConfig: (e: NodeJS.ProcessEnv) => any };

const mail: MailPort = {
  async send(m) {
    sent.push(m);
    return { providerMessageId: `m${sent.length}` };
  },
};

// Real SDK instance: webhook verification is local and exercised against real Stripe signature headers.
const stripe = new Stripe('sk_test_offline');
const fakeSessions = {
  create: async (params: any, options: { idempotencyKey: string }) => {
    createdParams.push({ params, key: options.idempotencyKey });
    const id = nextSessionId ?? `cs_test_${createdParams.length}_${Math.random().toString(36).slice(2, 8)}`;
    nextSessionId = undefined;
    return { id, url: `https://checkout.stripe.test/${id}` };
  },
  retrieve: async (id: string) => toStripe(sessions.get(id)!),
  list: async () => {
    const page = listPages.shift();
    return { data: page?.data.map(toStripe) ?? [], has_more: page?.hasMore ?? false };
  },
};
(stripe as any).checkout = { sessions: fakeSessions };

function toStripe(s: CheckoutSessionSnapshot): any {
  return {
    id: s.id,
    mode: s.mode,
    status: s.status,
    payment_status: s.paymentStatus,
    currency: s.currency?.toLowerCase(),
    amount_total: s.amountTotalMinor,
    client_reference_id: s.clientReferenceId,
    payment_intent: s.paymentIntentId,
    customer_details: { email: s.customerEmail },
    created: s.createdUnix,
  };
}

function paidSession(id: string, attemptId: string, pi: string, amount = 4900, overrides: Partial<CheckoutSessionSnapshot> = {}): CheckoutSessionSnapshot {
  const s: CheckoutSessionSnapshot = {
    id,
    mode: 'payment',
    status: 'complete',
    paymentStatus: 'paid',
    currency: 'EUR',
    amountTotalMinor: amount,
    clientReferenceId: attemptId,
    paymentIntentId: pi,
    customerEmail: 'buyer@example.test',
    createdUnix: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  sessions.set(id, s);
  return s;
}

function signedEvent(id: string, type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header };
}

async function webhook(id: string, type: string, object: Record<string, unknown>, headerOverride?: string) {
  const { payload, header } = signedEvent(id, type, object);
  return routes['payments-webhook'].handler(
    makeRequest('POST', 'webhooks/stripe', { raw: payload, headers: { 'stripe-signature': headerOverride ?? header } }),
    invocation,
  );
}

function configFor(env: Record<string, string> = {}) {
  return deps.loadConfig({
    APP_BASE_URL: APP_ORIGIN,
    OWNER_IDENTITY_PROVIDER: 'github',
    OWNER_USER_ID: '4242',
    DATABASE_URL: dbUrl,
    ...env,
  } as NodeJS.ProcessEnv);
}

// The real adapter (createStripePayments) runs in every test; only the SDK's network methods are faked.
let adapter: PaymentPort;

beforeAll(async () => {
  server = await startPostgres(54_404);
  dbUrl = await server.createMigrated('payments');
  db = new pg.Pool({ connectionString: dbUrl, max: 4 });
  routes = (await import('../../api/src/functions/payments.js')).paymentRoutes as any;
  await import('../../api/src/functions/routes.js');
  deps = {
    setDepsForTesting: (await import('../../api/src/core/deps.js')).setDepsForTesting as any,
    loadConfig: (await import('../../api/src/core/config.js')).loadConfig,
  };
  const { createStripePayments } = await import('../../api/src/services/stripe.js');
  adapter = createStripePayments({ secretKey: 'sk_test_offline', webhookSecret: WEBHOOK_SECRET, client: stripe });
}, 180_000);

afterAll(async () => {
  deps?.setDepsForTesting(undefined);
  await db?.end();
  await server?.stop();
});

beforeEach(async () => {
  sessions = new Map();
  createdParams = [];
  listPages = [];
  sent = [];
  await db.query(
    `TRUNCATE webhook_events, refunds, order_items, orders, checkout_attempts, entitlement_grants, entitlements,
              free_claim_tokens, login_tokens, sessions, customers, email_outbox, audit_events, rate_limits,
              reconciliation_runs, product_versions, lesson_progress, lessons, sections, lesson_resources, assets,
              products, shop_settings RESTART IDENTITY CASCADE`,
  );
  await seedShop(db);
  deps.setDepsForTesting({ config: configFor(), db: () => db, mail, payments: () => adapter });
});

const checkoutCall = (body: unknown, key = 'key-12345678', origin: string | null = APP_ORIGIN) =>
  routes['payments-checkout'].handler(
    makeRequest('POST', 'checkout', { json: body, headers: { 'idempotency-key': key }, origin }),
    invocation,
  );

async function countOrders(): Promise<number> {
  return (await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;
}

async function attemptFor(slug: string): Promise<string> {
  const { rows } = await db.query('SELECT ca.id FROM checkout_attempts ca JOIN products p ON p.id = ca.product_id WHERE p.slug = $1 ORDER BY ca.created_at DESC LIMIT 1', [slug]);
  return rows[0].id;
}

describe('checkout (P01)', () => {
  it('prices from the database, never from the browser, and pins the success URL to the return page', async () => {
    deps.setDepsForTesting({ config: configFor(), db: () => db, mail, payments: () => adapter });
    const response = await checkoutCall({ slug: 'course-one', email: 'Buyer@Example.test', amountMinor: 1, currency: 'USD' });
    expect(response.status).toBe(200);
    expect(bodyOf(response).url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const sent = createdParams.at(-1)!;
    expect(sent.params.line_items[0].price_data).toMatchObject({ unit_amount: 4900, currency: 'eur' });
    expect(sent.params.success_url).toBe(`${APP_ORIGIN}/checkout/return?session_id={CHECKOUT_SESSION_ID}`);
    expect(sent.params.customer_email).toBe('buyer@example.test');
  });

  it('refuses checkout until seller, legal, consent and tax choices are complete', async () => {
    await seedShop(db, { ready: false });
    const response = await checkoutCall({ slug: 'course-one', email: 'buyer@example.test' });
    expect(response.status).toBe(409);
    expect(bodyOf(response).error.message).toContain('seller.legalName');
    expect(bodyOf(response).error.message).toContain('taxMode');
    expect(createdParams.length).toBe(0);
  });

  it('refuses draft, unknown and free products through the paid path', async () => {
    expect((await checkoutCall({ slug: 'draft-only', email: 'buyer@example.test' })).status).toBe(404);
    expect((await checkoutCall({ slug: 'no-such', email: 'buyer@example.test' })).status).toBe(404);
    expect((await checkoutCall({ slug: 'free-guide', email: 'buyer@example.test' })).status).toBe(400);
  });

  it('requires same origin and a valid Idempotency-Key', async () => {
    expect((await checkoutCall({ slug: 'course-one', email: 'buyer@example.test' }, 'key-12345678', 'https://evil.test')).status).toBe(403);
    expect((await checkoutCall({ slug: 'course-one', email: 'buyer@example.test' }, 'bad key!')).status).toBe(400);
  });

  it('retries with the same key reuse the attempt and idempotency key; a reused key for another email is refused', async () => {
    await checkoutCall({ slug: 'course-one', email: 'buyer@example.test' }, 'retry-key-0001');
    await checkoutCall({ slug: 'course-one', email: 'buyer@example.test' }, 'retry-key-0001');
    expect((await db.query('SELECT count(*)::int AS n FROM checkout_attempts')).rows[0].n).toBe(1);
    expect(createdParams.map((c) => c.key)[0]).toBe(createdParams.map((c) => c.key)[1]);
    const other = await checkoutCall({ slug: 'course-one', email: 'other@example.test' }, 'retry-key-0001');
    expect(other.status).toBe(409);
  });
});

describe('fulfillment webhooks (P02)', () => {
  it('rejects an unsigned or tampered webhook and grants nothing', async () => {
    const attemptId = await createAttempt('cs_t1');
    paidSession('cs_t1', attemptId, 'pi_t1');
    const bad = await webhook('evt_bad', 'checkout.session.completed', { id: 'cs_t1' }, 't=1,v1=deadbeef');
    expect(bad.status).toBe(400);
    expect(await countOrders()).toBe(0);
  });

  it('fulfils a paid session once: order, snapshot item, grant, active entitlement, purchase email, and library access', async () => {
    const attemptId = await createAttempt('cs_ok');
    paidSession('cs_ok', attemptId, 'pi_ok');
    const response = await webhook('evt_1', 'checkout.session.completed', { id: 'cs_ok' });
    expect(response.status).toBe(200);
    expect(bodyOf(response).outcome).toBe('fulfilled');
    const order = await db.query('SELECT status, amount_minor, provider_payment_id FROM orders');
    expect(order.rows[0]).toMatchObject({ status: 'paid', amount_minor: 4900, provider_payment_id: 'pi_ok' });
    expect((await db.query('SELECT title_snapshot FROM order_items')).rows[0].title_snapshot).toBe('Course One');
    expect((await db.query(`SELECT status FROM entitlements`)).rows[0].status).toBe('active');
    expect(sent.some((m) => m.subject.includes('Course One'))).toBe(true);
    const outbox = await db.query(`SELECT status FROM email_outbox WHERE template = 'purchase_access'`);
    expect(outbox.rows[0].status).toBe('sent');
  });

  it('treats duplicate deliveries as no-ops, including concurrent ones, and never duplicates access or email', async () => {
    const attemptId = await createAttempt('cs_dup');
    paidSession('cs_dup', attemptId, 'pi_dup');
    const results = await Promise.all([
      webhook('evt_same', 'checkout.session.completed', { id: 'cs_dup' }),
      webhook('evt_same', 'checkout.session.completed', { id: 'cs_dup' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await countOrders()).toBe(1);
    // A different event for the same session (replay or reconciliation) finds the existing order.
    const later = await webhook('evt_other', 'checkout.session.completed', { id: 'cs_dup' });
    expect(bodyOf(later).outcome).toBe('already_fulfilled');
    expect((await db.query('SELECT count(*)::int AS n FROM entitlement_grants')).rows[0].n).toBe(1);
    expect((await db.query(`SELECT count(*)::int AS n FROM email_outbox WHERE template='purchase_access'`)).rows[0].n).toBe(1);
  });

  it('records an amount mismatch for the owner without granting access', async () => {
    const attemptId = await createAttempt('cs_short');
    paidSession('cs_short', attemptId, 'pi_short', 100);
    const response = await webhook('evt_short', 'checkout.session.completed', { id: 'cs_short' });
    expect(bodyOf(response).outcome).toBe('recorded_mismatch');
    expect(await countOrders()).toBe(0);
    const failures = await db.query(`SELECT status, last_error FROM webhook_events WHERE provider_event_id = 'evt_short'`);
    expect(failures.rows[0].status).toBe('failed');
    expect(failures.rows[0].last_error).toContain('does not match the server-side price');
  });

  it('asks the provider to redeliver when a session is still unpaid', async () => {
    const attemptId = await createAttempt('cs_unpaid');
    paidSession('cs_unpaid', attemptId, 'pi_unpaid', 4900, { paymentStatus: 'unpaid' });
    const response = await webhook('evt_unpaid', 'checkout.session.completed', { id: 'cs_unpaid' });
    expect(response.status).toBe(500);
    expect(await countOrders()).toBe(0);
  });

  it('keeps the webhook body verified against the exact raw bytes', async () => {
    const attemptId = await createAttempt('cs_raw');
    paidSession('cs_raw', attemptId, 'pi_raw');
    const { payload, header } = signedEvent('evt_raw', 'checkout.session.completed', { id: 'cs_raw' });
    const tampered = payload.replace('"object":"event"', '"object": "event" ');
    const response = await routes['payments-webhook'].handler(
      makeRequest('POST', 'webhooks/stripe', { raw: tampered, headers: { 'stripe-signature': header } }),
      invocation,
    );
    expect(response.status).toBe(400);
  });
});

describe('refunds and disputes (P03)', () => {
  async function purchase(session: string, pi: string) {
    const attemptId = await createAttempt(session);
    paidSession(session, attemptId, pi);
    await webhook(`evt_${session}`, 'checkout.session.completed', { id: session });
  }

  const refund = (id: string, pi: string, amount: number, status = 'succeeded') => ({ id, object: 'refund', payment_intent: pi, amount, currency: 'eur', status });

  it('a partial refund keeps access and flags the order for the owner', async () => {
    await purchase('cs_p1', 'pi_p1');
    const response = await webhook('evt_r1', 'refund.created', refund('re_1', 'pi_p1', 1000));
    expect(bodyOf(response).outcome).toBe('applied');
    const order = await db.query(`SELECT status, refunded_minor FROM orders`);
    expect(order.rows[0]).toMatchObject({ status: 'partially_refunded', refunded_minor: 1000 });
    expect((await db.query('SELECT status FROM entitlements')).rows[0].status).toBe('active');
  });

  it('a full refund revokes access and blocks new entitlement paths; redelivery never double-counts', async () => {
    await purchase('cs_f1', 'pi_f1');
    await webhook('evt_rf1', 'refund.created', refund('re_full', 'pi_f1', 4900));
    expect(bodyOf(await webhook('evt_rf1b', 'refund.created', refund('re_full', 'pi_f1', 4900)))).toMatchObject({ outcome: 'duplicate_event' });
    const order = await db.query(`SELECT status, refunded_minor FROM orders`);
    expect(order.rows[0]).toMatchObject({ status: 'refunded', refunded_minor: 4900 });
    expect((await db.query('SELECT status FROM entitlements')).rows[0].status).toBe('revoked');
    expect((await db.query(`SELECT status FROM entitlement_grants`)).rows[0].status).toBe('revoked');
    expect(sent.some((m) => m.subject.startsWith('Access update'))).toBe(true);
  });

  it('a refund that arrives before its paid checkout is retried, then applied once the order exists', async () => {
    const early = await webhook('evt_early', 'refund.created', refund('re_early', 'pi_late', 4900));
    expect(early.status).toBe(500);
    const attemptId = await createAttempt('cs_late');
    paidSession('cs_late', attemptId, 'pi_late');
    await webhook('evt_late_paid', 'checkout.session.completed', { id: 'cs_late' });
    const retry = await webhook('evt_early', 'refund.created', refund('re_early', 'pi_late', 4900));
    expect(bodyOf(retry).outcome).toBe('applied');
    // A late duplicate of the paid event must not restore access after the refund.
    const replay = await webhook('evt_late_replay', 'checkout.session.completed', { id: 'cs_late' });
    expect(bodyOf(replay).outcome).toBe('already_fulfilled');
    expect((await db.query('SELECT status FROM entitlements')).rows[0].status).toBe('revoked');
  });

  it('revokes only the grant of the refunded order when the customer holds another purchase of the same product', async () => {
    await purchase('cs_two_a', 'pi_two_a');
    await purchase('cs_two_b', 'pi_two_b');
    expect((await db.query('SELECT count(*)::int AS n FROM entitlement_grants')).rows[0].n).toBe(2);
    await webhook('evt_two', 'refund.created', refund('re_two', 'pi_two_a', 4900));
    expect((await db.query('SELECT status FROM entitlements')).rows[0].status).toBe('active');
    expect((await db.query(`SELECT count(*)::int AS n FROM entitlement_grants WHERE status = 'revoked'`)).rows[0].n).toBe(1);
  });

  it('suspends access on an open dispute and restores it when won, or revokes it when lost', async () => {
    await purchase('cs_d1', 'pi_d1');
    const disputeOpen = { id: 'dp_1', object: 'dispute', payment_intent: 'pi_d1', status: 'needs_response', amount: 4900 };
    await webhook('evt_dp_open', 'charge.dispute.created', disputeOpen);
    expect((await db.query('SELECT status FROM entitlements')).rows[0].status).toBe('suspended');
    await webhook('evt_dp_won', 'charge.dispute.closed', { ...disputeOpen, status: 'won' });
    expect((await db.query('SELECT status FROM entitlements')).rows[0].status).toBe('active');
    await webhook('evt_dp_open2', 'charge.dispute.created', disputeOpen);
    await webhook('evt_dp_lost', 'charge.dispute.closed', { ...disputeOpen, status: 'lost' });
    expect((await db.query('SELECT status FROM entitlements')).rows[0].status).toBe('revoked');
  });
});

describe('free claims (P04)', () => {
  it('grants a free product only after the emailed link is confirmed, once', async () => {
    await routes['free-claims'].handler(makeRequest('POST', 'free-claims', { json: { slug: 'free-guide', email: 'free@example.test' } }), invocation);
    const token = new URL(sent.at(-1)!.text.split('\n').find((l) => l.includes('/account/claim'))!).searchParams.get('token')!;
    expect((await db.query('SELECT count(*)::int AS n FROM entitlement_grants')).rows[0].n).toBe(0);
    const first = await routes['free-claims-confirm'].handler(makeRequest('POST', 'free-claims/confirm', { json: { token } }), invocation);
    expect(bodyOf(first)).toEqual({ productSlug: 'free-guide', alreadyClaimed: false });
    const again = await routes['free-claims-confirm'].handler(makeRequest('POST', 'free-claims/confirm', { json: { token } }), invocation);
    expect(again.status).toBe(401);
    expect((await db.query('SELECT count(*)::int AS n FROM entitlement_grants')).rows[0].n).toBe(1);
  });

  it('never sends a claim email for a paid or unknown product', async () => {
    await routes['free-claims'].handler(makeRequest('POST', 'free-claims', { json: { slug: 'course-one', email: 'x@example.test' } }), invocation);
    await routes['free-claims'].handler(makeRequest('POST', 'free-claims', { json: { slug: 'nope-nope', email: 'x@example.test' } }), invocation);
    expect(sent.length).toBe(0);
  });
});

describe('receipts and reconciliation (P05)', () => {
  it('shows a buyer only their own receipts and refuses other order IDs', async () => {
    const attemptId = await createAttempt('cs_receipt_1');
    paidSession('cs_receipt_1', attemptId, 'pi_rec');
    await webhook('evt_rec', 'checkout.session.completed', { id: 'cs_receipt_1' });
    const orderId = (await db.query('SELECT id FROM orders')).rows[0].id;
    const login = await routes['payments-status'].handler(makeRequest('GET', 'checkout/status?sessionId=cs_receipt_1'), invocation);
    expect(bodyOf(login).status).toBe('paid');
    // The buyer signs in through the normal link flow; here the session is created directly for the customer.
    const customer = (await db.query('SELECT id FROM customers')).rows[0].id;
    const { createSession } = await import('../../api/src/auth/session.js');
    const client = await db.connect();
    let token = '';
    try {
      await client.query('BEGIN');
      token = (await createSession(client as any, customer)).token;
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const cookie = { cookie: `__Host-pagelet_session=${token}` };
    const list = await routes['orders-list'].handler(makeRequest('GET', 'orders', { headers: cookie }), invocation);
    expect(bodyOf(list).items[0].items[0].title).toBe('Course One');
    const get = await routes['orders-get'].handler(Object.assign(makeRequest('GET', `orders/${orderId}`, { headers: cookie }), { params: { orderId } }), invocation);
    expect(get.status).toBe(200);
    expect(String(get.body)).not.toContain('pi_rec');
    const other = '00000000-0000-4000-8000-0000000000ff';
    const denied = await routes['orders-get'].handler(Object.assign(makeRequest('GET', `orders/${other}`, { headers: cookie }), { params: { orderId: other } }), invocation);
    expect(denied.status).toBe(404);
  });

  it('recovers a missed webhook through reconciliation without duplicating the order', async () => {
    const attemptId = await createAttempt('cs_missed');
    paidSession('cs_missed', attemptId, 'pi_missed');
    listPages = [{ data: [sessions.get('cs_missed')!], hasMore: true }];
    const { reconcilePayments } = await import('../../api/src/services/reconciliation.js');
    const { getDeps } = await import('../../api/src/core/deps.js');
    const logger = (await import('../../api/src/core/logger.js')).createLogger(() => undefined);
    const report = await reconcilePayments(getDeps(), logger, { createdSinceUnix: 0 });
    expect(report).toMatchObject({ scanned: 1, fulfilled: 1, nextCursor: 'cs_missed' });
    listPages = [{ data: [sessions.get('cs_missed')!], hasMore: false }];
    const rerun = await reconcilePayments(getDeps(), logger, { createdSinceUnix: 0 });
    expect(rerun.fulfilled).toBe(0);
    expect(rerun.alreadyFulfilled).toBe(1);
    expect(await countOrders()).toBe(1);
  });
});

async function createAttempt(sessionName: string): Promise<string> {
  nextSessionId = sessionName;
  const response = await checkoutCall({ slug: 'course-one', email: 'buyer@example.test' }, `key-${Math.random().toString(36).slice(2, 12)}`);
  expect(response.status).toBe(200);
  return attemptFor('course-one');
}
