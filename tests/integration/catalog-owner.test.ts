import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, paramsFrom, type Harness } from '../helpers/catalog.js';
import { makeRequest, invocation, principalHeader, bodyOf } from '../helpers/api.js';

let h: Harness;
let routes: Record<string, { route: string; methods: string[]; handler: (r: any, i: any) => Promise<any> }>;
const ID = '00000000-0000-4000-8000-0000000000aa';

beforeAll(async () => {
  h = await startHarness(54_413, 'catalog_owner');
  const catalog = await import('../../api/src/functions/catalog.js');
  const core = await import('../../api/src/functions/routes.js');
  routes = { ...core.routes, ...catalog.catalogRoutes } as any;
}, 180_000);

afterAll(async () => {
  await h?.close();
});

const OWNER_ROUTES = () => Object.keys(routes).filter((n) => n.startsWith('owner-'));

async function attempt(name: string, principal?: string) {
  const def = routes[name]!;
  const path = def.route.replace('{id}', ID).replace('{*rest}', 'x');
  const headers = principal ? { 'x-ms-client-principal': principal } : {};
  const request = makeRequest(def.methods[0]!, path, { headers, params: paramsFrom(def.route, path) });
  return def.handler(request, invocation);
}

describe('owner-only access (every owner route)', () => {
  it('discovers the owner catalog routes', () => {
    expect(OWNER_ROUTES().length).toBeGreaterThanOrEqual(20);
  });

  it('denies anonymous requests with 401 on every owner route', async () => {
    for (const name of OWNER_ROUTES()) {
      const res = await attempt(name);
      expect([401], `route ${name}`).toContain(res.status);
      expect(bodyOf(res).error.code, name).toBe('unauthorized');
    }
  });

  it('denies a different GitHub user and a lookalike provider with 403 on every owner route', async () => {
    for (const name of OWNER_ROUTES()) {
      for (const principal of [principalHeader('github', '9999'), principalHeader('aad', '4242')]) {
        const res = await attempt(name, principal);
        expect(res.status, `route ${name}`).toBe(403);
      }
    }
  });

  it('fails closed with 503 when the owner is not configured', async () => {
    await h.setConfig({ OWNER_USER_ID: undefined });
    for (const name of OWNER_ROUTES()) {
      const res = await attempt(name, principalHeader('github', '4242'));
      expect(res.status, `route ${name}`).toBe(503);
    }
    await h.setConfig({});
  });

  it('never grants owner access to a customer session cookie', async () => {
    for (const name of OWNER_ROUTES()) {
      const def = routes[name]!;
      const path = def.route.replace('{id}', ID);
      const request = makeRequest(def.methods[0]!, path, { headers: { cookie: '__Host-pagelet_session=customer-session-token' }, params: paramsFrom(def.route, path) });
      const res = await def.handler(request, invocation);
      expect(res.status, name).toBe(401);
    }
  });
});

