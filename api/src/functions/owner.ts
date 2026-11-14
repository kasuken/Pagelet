import { app, type HttpMethod, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { apiHandler, readJson, requireSameOrigin, validate, type Ctx, type Result } from '../core/http.js';
import { getDeps } from '../core/deps.js';
import { requireOwner } from '../auth/owner.js';
import { clearSessionCookie, readCookie, requireCustomer, revokeSession, SESSION_COOKIE } from '../auth/session.js';
import { customerReceipts } from '../services/receipts.js';
import * as owner from '../services/owner.js';
import { retryFailed } from '../services/outbox.js';
import { Uuid } from '@pagelet/contracts';

const config = () => getDeps().config;

interface Def {
  methods: HttpMethod[];
  route: string;
  handler: (request: HttpRequest, invocation: InvocationContext) => Promise<HttpResponseInit>;
}
const def = (method: HttpMethod, route: string, fn: (ctx: Ctx) => Promise<Result>): Def => ({ methods: [method], route, handler: apiHandler(config, fn, { route }) });

const ownerActor = (ctx: Ctx) => `owner:${requireOwner(ctx.request, config()).userId}`;
const param = (ctx: Ctx, name: string) => validate(Uuid, (ctx.request.params as Record<string, string>)[name]);

const GrantBody = z.object({ productId: Uuid, reason: z.string().trim().min(3).max(300) });
const RevokeBody = z.object({ reason: z.string().trim().min(3).max(300) });
const EraseBody = z.object({ confirm: z.literal('ERASE') });
const SelfEraseBody = z.object({ confirm: z.literal('DELETE') });
const RetentionBody = z.object({ confirm: z.literal('RUN') });

export const ownerRoutes: Record<string, Def> = {
  'owner-overview': def('GET', 'owner/overview', async (ctx) => {
    requireOwner(ctx.request, config());
    return { cache: 'private', body: await owner.overview(getDeps().db()) };
  }),

  'owner-orders': def('GET', 'owner/orders', async (ctx) => {
    requireOwner(ctx.request, config());
    const status = ctx.request.query.get('status') ?? undefined;
    const cursor = ctx.request.query.get('cursor') ?? undefined;
    const limit = ctx.request.query.get('limit') ? Number(ctx.request.query.get('limit')) : undefined;
    const input = validate(z.object({ status: z.enum(['paid', 'partially_refunded', 'refunded', 'disputed']).optional(), cursor: z.string().max(512).optional(), limit: z.number().int().min(1).max(50).optional() }), { status, cursor, limit });
    return { cache: 'private', body: await owner.listOrders(getDeps().db(), input) };
  }),

  'owner-order': def('GET', 'owner/orders/{orderId}', async (ctx) => {
    requireOwner(ctx.request, config());
    return { cache: 'private', body: await owner.orderDetail(getDeps().db(), param(ctx, 'orderId')) };
  }),

  'owner-product-publications': def('GET', 'owner/products/{productId}/publications', async (ctx) => {
    requireOwner(ctx.request, config());
    return { cache: 'private', body: await owner.productPublications(getDeps().db(), param(ctx, 'productId')) };
  }),

  'owner-customers': def('GET', 'owner/customers', async (ctx) => {
    requireOwner(ctx.request, config());
    const q = ctx.request.query.get('q') ?? undefined;
    const term = validate(z.string().max(254).optional(), q);
    return { cache: 'private', body: await owner.listCustomers(getDeps().db(), term) };
  }),

  'owner-customer': def('GET', 'owner/customers/{customerId}', async (ctx) => {
    requireOwner(ctx.request, config());
    return { cache: 'private', body: await owner.customerDetail(getDeps().db(), param(ctx, 'customerId')) };
  }),

  'owner-grant-complimentary': def('POST', 'owner/customers/{customerId}/complimentary', async (ctx) => {
    const actor = ownerActor(ctx);
    requireSameOrigin(ctx);
    const body = await readJson(ctx.request, GrantBody);
    const result = await owner.grantComplimentary(getDeps(), { customerId: param(ctx, 'customerId'), productId: body.productId, reason: body.reason, actor });
    return { status: 201, cache: 'private', body: result };
  }),

  'owner-revoke-grant': def('POST', 'owner/grants/{grantId}/revoke', async (ctx) => {
    const actor = ownerActor(ctx);
    requireSameOrigin(ctx);
    const body = await readJson(ctx.request, RevokeBody);
    return { cache: 'private', body: await owner.revokeComplimentary(getDeps(), { grantId: param(ctx, 'grantId'), reason: body.reason, actor }) };
  }),

  'owner-emails': def('GET', 'owner/emails', async (ctx) => {
    requireOwner(ctx.request, config());
    const status = validate(z.enum(['failed', 'pending']), ctx.request.query.get('status') ?? 'failed');
    return { cache: 'private', body: await owner.listEmails(getDeps().db(), status) };
  }),

  'owner-email-retry': def('POST', 'owner/emails/{emailId}/retry', async (ctx) => {
    const actor = ownerActor(ctx);
    requireSameOrigin(ctx);
    const deps = getDeps();
    const id = param(ctx, 'emailId');
    const result = await retryFailed(deps.db(), deps.mail, id, async () => {
      const { rows } = await deps.db().query('SELECT id, template, recipient_email_normalized, payload FROM email_outbox WHERE id = $1', [id]);
      if (!rows[0]) return null;
      return owner.rebuildMessage(deps.db(), rows[0], config().appOrigin ?? '');
    });
    await deps.db().query(`INSERT INTO audit_events (actor, action, subject_type, subject_id, details) VALUES ($1, 'email.retry', 'email', $2, $3::jsonb)`, [actor, id, JSON.stringify({ result })]);
    return { cache: 'private', body: { result } };
  }),

  'owner-audit': def('GET', 'owner/audit', async (ctx) => {
    requireOwner(ctx.request, config());
    const cursor = ctx.request.query.get('cursor') ?? undefined;
    return { cache: 'private', body: await owner.listAudit(getDeps().db(), { cursor }) };
  }),

  'owner-retention': def('POST', 'owner/retention', async (ctx) => {
    const actor = ownerActor(ctx);
    requireSameOrigin(ctx);
    await readJson(ctx.request, RetentionBody);
    return { cache: 'private', body: await owner.runRetention(getDeps().db(), actor) };
  }),

  'owner-erase-customer': def('POST', 'owner/customers/{customerId}/erase', async (ctx) => {
    const actor = ownerActor(ctx);
    requireSameOrigin(ctx);
    await readJson(ctx.request, EraseBody);
    return { cache: 'private', body: await owner.eraseCustomer(getDeps().db(), param(ctx, 'customerId'), actor) };
  }),
};

export const accountRoutes: Record<string, Def> = {
  'me-export': def('GET', 'me/export', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const [library, receipts, progress] = await Promise.all([
      deps.db().query('SELECT p.title, e.status FROM entitlements e JOIN products p ON p.id = e.product_id WHERE e.customer_id = $1', [customer.customerId]),
      customerReceipts(deps.db(), customer.customerId),
      deps.db().query('SELECT l.title, lp.resume_seconds, lp.completed_at FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id WHERE lp.customer_id = $1', [customer.customerId]),
    ]);
    return {
      cache: 'private',
      body: {
        account: { email: customer.email },
        library: library.rows,
        receipts,
        progress: progress.rows,
        exportedAt: new Date().toISOString(),
      },
    };
  }),

  'me-revoke-sessions': def('POST', 'me/sessions/revoke', async (ctx) => {
    requireSameOrigin(ctx);
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    await deps.db().query('UPDATE sessions SET revoked_at = now() WHERE customer_id = $1 AND revoked_at IS NULL', [customer.customerId]);
    return { status: 204, cache: 'none', cookies: [clearSessionCookie()] };
  }),

  'me-erase': def('POST', 'me/erase', async (ctx) => {
    requireSameOrigin(ctx);
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    await readJson(ctx.request, SelfEraseBody);
    await owner.eraseCustomer(deps.db(), customer.customerId, `customer:${customer.customerId}`);
    await revokeSession(deps.db(), readCookie(ctx.request, SESSION_COOKIE));
    return { status: 204, cache: 'none', cookies: [clearSessionCookie()] };
  }),
};

for (const [name, d] of Object.entries({ ...ownerRoutes, ...accountRoutes })) {
  app.http(name, { authLevel: 'anonymous', methods: d.methods, route: d.route, handler: d.handler });
}

