import pg from 'pg';
import { startPostgres, type TestDatabase } from './postgres.js';
import { APP_ORIGIN, invocation, makeRequest, principalHeader, type CallOptions } from './api.js';
import { FakeBlob } from './blob.js';

import { getDeps } from '../../api/src/core/deps.js';
import { createLogger } from '../../api/src/core/logger.js';
import { requestPublication, recordResult } from '../../api/src/services/publication.js';

export const OWNER = principalHeader('github', '4242');

export interface Harness {
  server: TestDatabase;
  db: pg.Pool;
  blob: FakeBlob;
  /** Calls an owner route by function name as the owner, unless `headers` overrides it. */
  owner(name: string, method: string, path: string, options?: CallOptions): Promise<any>;
  /** Calls any named route with a raw request (used for denial tests). */
  raw(name: string, method: string, path: string, options?: CallOptions): Promise<any>;
  setConfig(env: Record<string, string | undefined>): Promise<void>;
  close(): Promise<void>;
}

/** Shared setup: one embedded server per file, a migrated database, fake storage and the owner identity. */
export async function startHarness(port: number, dbName: string, env: Record<string, string | undefined> = {}): Promise<Harness> {
  const server = await startPostgres(port);
  const url = await server.createMigrated(dbName);
  const db = new pg.Pool({ connectionString: url, max: 2 });
  const blob = new FakeBlob();
  const catalog = await import('../../api/src/functions/catalog.js');
  const core = await import('../../api/src/functions/routes.js');
  const deps = await import('../../api/src/core/deps.js');
  const publish = { triggerBuild: async () => ({ runUrl: null }) };
  const { loadConfig } = await import('../../api/src/core/config.js');
  const configFor = (extra: Record<string, string | undefined>) =>
    loadConfig({ APP_BASE_URL: APP_ORIGIN, OWNER_IDENTITY_PROVIDER: 'github', OWNER_USER_ID: '4242', DATABASE_URL: url, ...extra } as NodeJS.ProcessEnv);
  const install = (extra: Record<string, string | undefined>) =>
    deps.setDepsForTesting({ config: configFor({ ...env, ...extra }), db: () => db, blob: () => blob, publish: () => publish });
  install({});
  const routes = { ...core.routes, ...catalog.catalogRoutes } as unknown as Record<string, { route: string; handler: (r: any, i: any) => Promise<any> }>;
  const invoke = (name: string, method: string, path: string, options: CallOptions = {}) => {
    const route = routes[name];
    if (!route) throw new Error(`no route ${name}`);
    return route.handler(makeRequest(method, path, { ...options, params: options.params ?? paramsFrom(route.route, path) }), invocation);
  };
  return {
    server,
    db,
    blob,
    owner: (name, method, path, options = {}) =>
      invoke(name, method, path, { ...options, headers: { 'x-ms-client-principal': OWNER, ...(options.headers ?? {}) } }),
    raw: invoke,
    async setConfig(extra) {
      install(extra);
    },
    async close() {
      deps.setDepsForTesting(undefined);
      await db.end();
      await server.stop();
    },
  };
}

/** Extracts {name} segments from a route template so tests need not pass params by hand. */
export function paramsFrom(template: string, path: string): Record<string, string> {
  const params: Record<string, string> = {};
  const actual = path.split('/');
  template.split('/').forEach((seg, i) => {
    const m = /^\{(\w+)\}$/.exec(seg);
    if (m && actual[i] !== undefined) params[m[1]!] = actual[i]!;
  });
  return params;
}

export async function body<T = any>(response: { body?: unknown }): Promise<T> {
  return JSON.parse(String(response.body ?? 'null')) as T;
}

/** Seeds the shop with a currency so products can be created. */
export async function seedShop(h: Harness, currency = 'EUR') {
  const res = await h.owner('owner-shop-update', 'PATCH', 'owner/shop', { json: { currency, shopName: 'Test shop' } });
  if (res.status !== 200) throw new Error(`seed shop failed: ${res.body}`);
  return res;
}

/** Uploads, stores and finalizes one asset as the owner. Returns the ready asset view. */
export async function readyAsset(h: Harness, input: { kind: string; productId?: string; mimeType: string; bytes: number; head: string; versionLabel?: string; replacesAssetId?: string }) {
  const created = await h.owner('owner-upload-create', 'POST', 'owner/media/uploads', {
    json: { kind: input.kind, productId: input.productId, mimeType: input.mimeType, declaredBytes: input.bytes, versionLabel: input.versionLabel, replacesAssetId: input.replacesAssetId },
  });
  if (created.status !== 201) throw new Error(`upload create failed: ${created.body}`);
  const asset = (await body(created)).asset;
  const { rows } = await h.db.query<{ object_key: string }>('SELECT object_key FROM assets WHERE id = $1', [asset.id]);
  h.blob.store(rows[0]!.object_key, input.mimeType, input.head, input.bytes);
  const fin = await h.owner('owner-upload-finalize', 'POST', `owner/media/uploads/${asset.id}/finalize`, { params: { id: asset.id } });
  if (fin.status !== 200) throw new Error(`finalize failed: ${fin.body}`);
  return (await body(fin)).asset;
}

/** Creates a published download product with a cover and one ready PDF. Returns ids and the current revision. */
export async function publishedDownload(h: Harness, slug = 'pdf-guide', priceMinor = 1000) {
  await seedShop(h);
  const created = await h.owner('owner-products-create', 'POST', 'owner/products', {
    json: { title: 'PDF guide', slug, productType: 'download', description: 'A guide', outcomes: ['Learn the basics'], priceMinor },
  });
  const product = (await body(created)).product;
  const cover = await readyAsset(h, { kind: 'cover', productId: product.id, mimeType: 'image/png', bytes: 2048, head: '\u0089PNG\r\n\u001a\nfixture' });
  const file = await readyAsset(h, { kind: 'file', productId: product.id, mimeType: 'application/pdf', bytes: 4096, head: '%PDF-1.7\n%fixture' });
  const patched = await h.owner('owner-product-update', 'PATCH', `owner/products/${product.id}`, {
    params: { id: product.id },
    json: { revision: product.revision, coverAssetId: cover.id },
  });
  const after = (await body(patched)).product;
  const pub = await requestPublication(getDeps(), createLogger(() => undefined), { productId: product.id, reason: 'publish', actor: 'owner' });
  await recordResult(getDeps().db(), { publicationId: pub.publicationId, outcome: 'succeeded' });
  return { productId: product.id as string, coverId: cover.id as string, fileId: file.id as string, versionNo: pub.versionNo, revision: after.revision };
}

/** Inserts a paid order for a customer on the product's latest version, with its entitlement and grant. */
export async function seedPurchase(h: Harness, input: { email: string; productId: string; createdAt?: string; revoked?: boolean }) {
  const { rows: [customer] } = await h.db.query<{ id: string }>(
    `INSERT INTO customers (id, email_normalized) VALUES (gen_random_uuid(), $1)
     ON CONFLICT (email_normalized) DO UPDATE SET email_normalized = EXCLUDED.email_normalized RETURNING id`,
    [input.email],
  );
  let { rows: [version] } = await h.db.query<{ id: string; price: number }>(
    `SELECT id, (snapshot->>'priceMinor')::int AS price FROM product_versions WHERE product_id = $1 ORDER BY version_no DESC LIMIT 1`,
    [input.productId],
  );
  if (!version) {
    // Fixture only: a sold product always has a version. Unpublished courses get one directly here.
    const { rows } = await h.db.query<{ id: string; price: number }>(
      `INSERT INTO product_versions (id, product_id, version_no, snapshot)
       VALUES (gen_random_uuid(), $1, 1, '{"priceMinor": 0}'::jsonb) RETURNING id, 0 AS price`,
      [input.productId],
    );
    version = rows[0];
  }
  const attempt = await h.db.query<{ id: string }>(
    `INSERT INTO checkout_attempts (id, product_id, product_version_id, email_normalized, idempotency_key, amount_minor, currency, status, expires_at)
     VALUES (gen_random_uuid(), $1, $2, $3, gen_random_uuid()::text, $4, 'EUR', 'complete', now() + interval '1 day') RETURNING id`,
    [input.productId, version!.id, input.email, version!.price],
  );
  const order = await h.db.query<{ id: string }>(
    `INSERT INTO orders (id, customer_id, checkout_attempt_id, provider_payment_id, amount_minor, currency, policy_version, created_at)
     VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, $3, 'EUR', 0, COALESCE($4::timestamptz, now())) RETURNING id`,
    [customer!.id, attempt.rows[0]!.id, version!.price, input.createdAt ?? null],
  );
  await h.db.query(
    `INSERT INTO order_items (id, order_id, product_id, product_version_id, title_snapshot, unit_price_minor, quantity)
     VALUES (gen_random_uuid(), $1, $2, $3, 'snapshot', $4, 1)`,
    [order.rows[0]!.id, input.productId, version!.id, version!.price],
  );
  await h.db.query(
    `INSERT INTO entitlement_grants (id, customer_id, product_id, source, order_id, status, created_at)
     VALUES (gen_random_uuid(), $1, $2, 'purchase', $3, $4, COALESCE($5::timestamptz, now()))`,
    [customer!.id, input.productId, order.rows[0]!.id, input.revoked ? 'revoked' : 'active', input.createdAt ?? null],
  );
  await h.db.query(
    `INSERT INTO entitlements (customer_id, product_id, status) VALUES ($1, $2, $3)
     ON CONFLICT (customer_id, product_id) DO UPDATE SET status = EXCLUDED.status`,
    [customer!.id, input.productId, input.revoked ? 'revoked' : 'active'],
  );
  return { customerId: customer!.id as string, orderId: order.rows[0]!.id as string };
}
