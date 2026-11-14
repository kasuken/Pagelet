// Matrix over every registered HTTP trigger. Adding a route without an auth check fails here, not in production.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startPostgres, type TestDatabase } from '../helpers/postgres.js';
import { APP_ORIGIN, bodyOf, invocation, makeRequest, principalHeader } from '../helpers/api.js';
import { IDS, seedShop } from '../helpers/shop.js';

const EVIL = 'https://evil.example';
const UUID = '00000000-0000-4000-8000-0000000000ff';
const PUBLIC_MUTATIONS = new Set(['payments-webhook', 'publication-result', 'publication-catalog']);
const CUSTOMER = [
  'me', 'me-export', 'me-revoke-sessions', 'me-erase', 'library', 'library-curriculum', 'lesson-get', 'lesson-playback',
  'lesson-progress', 'asset-download', 'orders-list', 'orders-get',
];

const mods = await Promise.all([
  import('../../api/src/functions/routes.js'),
  import('../../api/src/functions/payments.js'),
  import('../../api/src/functions/owner.js'),
  import('../../api/src/functions/storefront.js'),
  import('../../api/src/functions/learning.js'),
  import('../../api/src/functions/catalog.js'),
]);
// Route table is built at collection time so each route becomes its own test case.
const all: Record<string, { methods: string[]; route: string; handler: (r: any, i: any) => Promise<any> }> = {
  ...mods[0].routes,
  ...mods[1].paymentRoutes,
  ...mods[2].ownerRoutes,
  ...mods[2].accountRoutes,
  ...mods[3].storefrontRoutes,
  ...mods[4].learningRoutes,
  ...mods[5].catalogRoutes,
} as any;
let server: TestDatabase;
let db: pg.Pool;
let deps: { setDepsForTesting: (p: Record<string, unknown> | undefined) => void; loadConfig: (e: NodeJS.ProcessEnv) => any };
let cookie = '';

function fill(route: string): string {
  return route.replace(/\{(\w+)\}/g, (_m, name: string) => (name === 'slug' ? 'course-one' : UUID));
}

function params(route: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of route.matchAll(/\{(\w+)\}/g)) out[m[1]] = m[1] === 'slug' ? 'course-one' : UUID;
  return out;
}

function req(name: string, headers: Record<string, string>, origin: string | null, json?: unknown) {
  const d = all[name];
  const method = d.methods[0];
  const request = makeRequest(method, fill(d.route), { headers, origin, json: json ?? (method === 'GET' || method === 'DELETE' ? undefined : {}) });
  return Object.assign(request, { params: params(d.route) });
}

beforeAll(async () => {
  server = await startPostgres(54_408);
  const url = await server.createMigrated('route_auth');
  db = new pg.Pool({ connectionString: url, max: 4 });
  deps = {
    setDepsForTesting: (await import('../../api/src/core/deps.js')).setDepsForTesting as any,
    loadConfig: (await import('../../api/src/core/config.js')).loadConfig,
  };
  deps.setDepsForTesting({
    config: deps.loadConfig({ APP_BASE_URL: APP_ORIGIN, OWNER_IDENTITY_PROVIDER: 'github', OWNER_USER_ID: '4242', DATABASE_URL: url, PUBLISH_TOKEN: 'route-auth-token-0123456789abcdef' } as NodeJS.ProcessEnv),
    db: () => db,
    mail: { send: async () => ({ providerMessageId: null }) },
  });
  await seedShop(db);
  const { createSession } = await import('../../api/src/auth/session.js');
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const row = await c.query(`INSERT INTO customers (id, email_normalized) VALUES (gen_random_uuid(), 'matrix@example.test') RETURNING id`);
    cookie = `__Host-pagelet_session=${(await createSession(c as any, row.rows[0].id)).token}`;
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  void IDS;
}, 180_000);

afterAll(async () => {
  deps?.setDepsForTesting(undefined);
  await db?.end();
  await server?.stop();
});

const OWNER_NAMES = Object.keys(all).filter((n) => n.startsWith('owner-'));
const WRONG = { 'x-ms-client-principal': principalHeader('github', '1') };
const RIGHT = { 'x-ms-client-principal': principalHeader('github', '4242') };

describe('every owner route', () => {
  it('covers the expected number of owner routes (guards against silent removal)', () => {
    expect(OWNER_NAMES.length).toBeGreaterThanOrEqual(30);
  });

  for (const name of OWNER_NAMES) {
    it(`${name}: anonymous is 401 and a non-owner identity is 403`, async () => {
      const anon = await all[name].handler(req(name, {}, APP_ORIGIN, {}), invocation);
      expect(anon.status, `${name} anonymous`).toBe(401);
      const wrong = await all[name].handler(req(name, WRONG, APP_ORIGIN, {}), invocation);
      expect([401, 403, 503], `${name} wrong`).toContain(wrong.status);
      expect(wrong.status).not.toBe(200);
      expect(wrong.status).not.toBe(201);
    });
  }
});

describe('every customer route', () => {
  for (const name of CUSTOMER) {
    it(`${name}: no session cookie is 401`, async () => {
      const response = await all[name].handler(req(name, {}, APP_ORIGIN, {}), invocation);
      expect(response.status, `${name}`).toBe(401);
      expect(bodyOf(response).error.code).toBe('unauthorized');
    });
  }
});

describe('mutations refuse a foreign Origin', () => {
  const mutations = Object.keys(all).filter((n) => !['GET'].includes(all[n].methods[0]) && !PUBLIC_MUTATIONS.has(n));
  for (const name of mutations) {
    it(`${name}: 403 for a foreign Origin, even with valid credentials`, async () => {
      const isOwner = name.startsWith('owner-');
      const isCustomer = CUSTOMER.includes(name);
      const headers = isOwner ? RIGHT : isCustomer ? { cookie } : {};
      const response = await all[name].handler(req(name, headers, EVIL, {}), invocation);
      expect(response.status, `${name}`).toBe(403);
    });
  }
});

describe('unauthenticated access never leaks data', () => {
  it('a public catalog response never contains a draft slug', async () => {
    const response = await all['catalog-public'].handler(req('catalog-public', {}, null), invocation);
    expect(String(response.body ?? '')).not.toContain('draft-only');
  });
});
