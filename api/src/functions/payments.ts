import { app, type HttpMethod, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { Email, Slug, LocalPath } from '@pagelet/contracts';
import { apiHandler, readBoundedBody, requireSameOrigin, readJson, validate, WEBHOOK_LIMIT, type Ctx, type Result } from '../core/http.js';
import { getDeps } from '../core/deps.js';
import { ApiError, apiErrors } from '../core/errors.js';
import { requireOwner } from '../auth/owner.js';
import { requireCustomer } from '../auth/session.js';
import { startCheckout, checkoutStatus } from '../services/checkout.js';
import { handleVerifiedEvent } from '../services/fulfillment.js';
import { requestFreeClaim, confirmFreeClaim } from '../services/claims.js';
import { customerReceipts, customerReceipt } from '../services/receipts.js';
import { reconcilePayments } from '../services/reconciliation.js';
import { SessionRequest } from '@pagelet/contracts';

const config = () => getDeps().config;
const sourceOf = (request: HttpRequest) => request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

const CheckoutRequest = z.object({ slug: Slug, email: Email, returnTo: LocalPath.optional() });
const ClaimRequest = z.object({ slug: Slug, email: Email });
const ReconcileRequest = z.object({
  createdSinceUnix: z.number().int().nonnegative().optional(),
  startingAfter: z.string().max(255).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

interface Def {
  methods: HttpMethod[];
  route: string;
  handler: (request: HttpRequest, invocation: InvocationContext) => Promise<HttpResponseInit>;
}

const def = (method: HttpMethod, route: string, fn: (ctx: Ctx) => Promise<Result>): Def => ({
  methods: [method],
  route,
  handler: apiHandler(config, fn, { route }),
});

export const paymentRoutes: Record<string, Def> = {
  'payments-checkout': def('POST', 'checkout', async (ctx) => {
    requireSameOrigin(ctx);
    const body = await readJson(ctx.request, CheckoutRequest);
    const key = ctx.request.headers.get('idempotency-key') ?? '';
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      throw apiErrors.validation([{ path: 'Idempotency-Key', message: 'Send a unique key of 8–128 letters, digits, hyphens or underscores.' }]);
    }
    const origin = config().appOrigin;
    if (!origin) throw apiErrors.unavailable('Checkout is not configured for this installation.');
    const started = await startCheckout(getDeps(), { slug: body.slug, email: body.email, idempotencyKey: key, origin });
    return { cache: 'none', body: { url: started.url } };
  }),

  'payments-status': def('GET', 'checkout/status', async (ctx) => {
    const sessionId = ctx.request.query.get('sessionId') ?? '';
    const parsed = validate(z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]{5,200}$/) }), { sessionId });
    return { cache: 'none', body: await checkoutStatus(getDeps().db(), parsed.sessionId) };
  }),

  'payments-webhook': def('POST', 'webhooks/stripe', async (ctx) => {
    const signature = ctx.request.headers.get('stripe-signature');
    if (!signature) throw new ApiError(400, 'validation_failed', 'The signature header is missing.');
    const raw = await readBoundedBody(ctx.request, WEBHOOK_LIMIT);
    const deps = getDeps();
    let event;
    try {
      event = deps.payments().verifyWebhook(raw, signature);
    } catch {
      // Do not echo the signature or payload back to the caller.
      throw new ApiError(400, 'validation_failed', 'The webhook signature is not valid.');
    }
    // Any thrown error (transient) becomes 500 so the provider redelivers.
    const outcome = await handleVerifiedEvent(deps, ctx.log, event);
    return { cache: 'none', body: { received: true, outcome } };
  }),

  'free-claims': def('POST', 'free-claims', async (ctx) => {
    requireSameOrigin(ctx);
    const body = await readJson(ctx.request, ClaimRequest);
    await requestFreeClaim(getDeps(), ctx.log, { slug: body.slug, email: body.email, source: sourceOf(ctx.request) });
    return { status: 202, cache: 'none', body: { status: 'accepted', message: 'If this product is free and the address is valid, a confirmation link is on its way.' } };
  }),

  'free-claims-confirm': def('POST', 'free-claims/confirm', async (ctx) => {
    requireSameOrigin(ctx);
    const body = await readJson(ctx.request, SessionRequest);
    return { cache: 'none', body: await confirmFreeClaim(getDeps(), body.token) };
  }),

  'orders-list': def('GET', 'orders', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    return { cache: 'private', body: { items: await customerReceipts(deps.db(), customer.customerId) } };
  }),

  'orders-get': def('GET', 'orders/{orderId}', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const orderId = validate(z.uuid(), ctx.request.params.orderId);
    return { cache: 'private', body: await customerReceipt(deps.db(), customer.customerId, orderId) };
  }),

  'owner-reconcile': def('POST', 'owner/reconciliation', async (ctx) => {
    requireOwner(ctx.request, config());
    requireSameOrigin(ctx);
    const body = await readJson(ctx.request, ReconcileRequest);
    const since = body.createdSinceUnix ?? Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    const report = await reconcilePayments(getDeps(), ctx.log, { createdSinceUnix: since, startingAfter: body.startingAfter, limit: body.limit });
    return { cache: 'private', body: report };
  }),

  'owner-webhook-failures': def('GET', 'owner/webhooks', async (ctx) => {
    requireOwner(ctx.request, config());
    const { rows } = await getDeps().db().query(
      `SELECT provider_event_id, event_type, received_at, last_error FROM webhook_events
        WHERE status = 'failed' ORDER BY received_at DESC LIMIT 50`,
    );
    return {
      cache: 'private',
      body: { items: rows.map((r) => ({ eventId: r.provider_event_id, type: r.event_type, receivedAt: new Date(r.received_at).toISOString(), reason: r.last_error })) },
    };
  }),
};

for (const [name, d] of Object.entries(paymentRoutes)) {
  app.http(name, { authLevel: 'anonymous', methods: d.methods, route: d.route, handler: d.handler });
}
