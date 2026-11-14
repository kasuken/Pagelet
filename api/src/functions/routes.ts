import { app, type HttpMethod, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { apiHandler, requireSameOrigin, validate, readJson, type Ctx, type Result } from '../core/http.js';
import { getDeps } from '../core/deps.js';
import { LoginLinkRequest, SessionRequest, CustomerMe } from '@pagelet/contracts';
import { apiErrors } from '../core/errors.js';
import { clearSessionCookie, readCookie, requireCustomer, revokeSession, sessionCookie, maskEmail, SESSION_COOKIE } from '../auth/session.js';
import { requireOwner } from '../auth/owner.js';
import { confirmLoginLink, requestLoginLink } from '../services/login.js';
import { customerLibrary } from '../services/entitlements.js';

const config = () => getDeps().config;
const handle = (route: string, method: 'GET' | 'POST', fn: (ctx: Ctx) => Promise<Result>) => ({
  methods: [method],
  route,
  handler: apiHandler(config, fn, { route }),
});

const sourceOf = (request: HttpRequest): string => {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
};

interface Def {
  methods: HttpMethod[];
  route: string;
  handler: (request: HttpRequest, invocation: InvocationContext) => Promise<HttpResponseInit>;
}
const table: Array<{ name: string; def: Def }> = [];
function register(def: Def, name: string) {
  table.push({ name, def });
}

// Health: no secrets, no customer data. Reports database reachability only.
register(
  handle('health', 'GET', async () => {
    const deps = getDeps();
    let database: 'ok' | 'not_configured' | 'unreachable' = 'not_configured';
    if (deps.config.env.DATABASE_URL) {
      try {
        await deps.db().query('SELECT 1');
        database = 'ok';
      } catch {
        database = 'unreachable';
      }
    }
    return { cache: 'none', body: { status: database === 'ok' ? 'ok' : 'degraded', database, checkedAt: new Date().toISOString() } };
  }),
  'health',
);

register(
  handle('auth/login-links', 'POST', async (ctx) => {
    requireSameOrigin(ctx);
    const body = await readJson(ctx.request, LoginLinkRequest);
    const returnTo = body.returnTo ?? '/library';
    await requestLoginLink(getDeps(), ctx.log, { email: body.email, returnTo, source: sourceOf(ctx.request) });
    // Same response whether or not an account exists.
    return { status: 202, cache: 'none', body: { status: 'accepted', message: 'If that address can sign in, a link is on its way.' } };
  }),
  'auth-login-links',
);

register(
  handle('auth/sessions', 'POST', async (ctx) => {
    requireSameOrigin(ctx);
    const { token } = await readJson(ctx.request, SessionRequest);
    const deps = getDeps();
    const previous = readCookie(ctx.request, SESSION_COOKIE);
    const session = await confirmLoginLink(deps, token);
    await revokeSession(deps.db(), previous); // rotate: a presented old session cannot be reused
    return {
      status: 200,
      cache: 'none',
      body: { returnTo: session.returnTo },
      cookies: [sessionCookie(session.sessionToken, session.maxAgeSeconds)],
    };
  }),
  'auth-sessions',
);

register(
  handle('auth/logout', 'POST', async (ctx) => {
    requireSameOrigin(ctx);
    await revokeSession(getDeps().db(), readCookie(ctx.request, SESSION_COOKIE));
    return { status: 204, cache: 'none', cookies: [clearSessionCookie()] };
  }),
  'auth-logout',
);

register(
  handle('me', 'GET', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const body = validate(CustomerMe, { customer: { maskedEmail: maskEmail(customer.email) } });
    return { cache: 'private', body };
  }),
  'me',
);

register(
  handle('library', 'GET', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const items = await customerLibrary(deps.db(), customer.customerId);
    return { cache: 'private', body: { items } };
  }),
  'library',
);

register(
  handle('owner/me', 'GET', async (ctx) => {
    const owner = requireOwner(ctx.request, getDeps().config);
    return { cache: 'private', body: { owner: { provider: owner.provider } } };
  }),
  'owner-me',
);

// Unknown API paths answer with JSON 404, never with the SPA shell.
table.push({
  name: 'api-not-found',
  def: {
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
    route: '{*rest}',
    handler: apiHandler(config, async () => {
      throw apiErrors.notFound('No API endpoint matches this path.');
    }, { route: 'catch-all' }),
  },
});

/** Every HTTP trigger, keyed by function name. Tests call these handlers directly. */
export const routes = Object.fromEntries(table.map(({ name, def }) => [name, def]));

for (const { name, def } of table) {
  app.http(name, {
    authLevel: 'anonymous',
    methods: def.methods,
    route: def.route,
    handler: def.handler,
  });
}

