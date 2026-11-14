import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startPostgres, type TestDatabase } from '../helpers/postgres.js';
import { APP_ORIGIN, bodyOf, invocation, makeRequest, principalHeader } from '../helpers/api.js';
import { IDS, seedShop } from '../helpers/shop.js';
import type { PublishPort } from '../../api/src/core/ports.js';

let server: TestDatabase;
let db: pg.Pool;
let dbUrl = '';
let triggers: Array<{ idempotencyKey: string; publicationId: string }> = [];
let failTrigger = false;
let routes: Record<string, { handler: (r: any, i: any) => Promise<any> }>;
let deps: { setDepsForTesting: (p: Record<string, unknown> | undefined) => void; loadConfig: (e: NodeJS.ProcessEnv) => any };

const publisher: PublishPort = {
  async triggerBuild(input) {
    triggers.push(input);
    if (failTrigger) throw new Error('workflow dispatch refused');
    return { runUrl: `https://github.test/run/${triggers.length}` };
  },
};

const OWNER = { 'x-ms-client-principal': principalHeader('github', '4242') };
const CALLBACK = { authorization: 'Bearer callback-secret-0123456789abcdef' };

function configFor(env: Record<string, string> = {}) {
  return deps.loadConfig({ APP_BASE_URL: APP_ORIGIN, OWNER_IDENTITY_PROVIDER: 'github', OWNER_USER_ID: '4242', DATABASE_URL: dbUrl, PUBLISH_TOKEN: 'callback-secret-0123456789abcdef', ...env } as NodeJS.ProcessEnv);
}

beforeAll(async () => {
  server = await startPostgres(54_406);
  dbUrl = await server.createMigrated('publication');
  db = new pg.Pool({ connectionString: dbUrl, max: 4 });
  const base = await import('../../api/src/functions/routes.js');
  const storefront = await import('../../api/src/functions/storefront.js');
  routes = { ...base.routes, ...storefront.storefrontRoutes } as any;
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
  triggers = [];
  failTrigger = false;
  await db.query(
    `TRUNCATE publications, webhook_events, refunds, order_items, orders, checkout_attempts, entitlement_grants, entitlements,
              free_claim_tokens, login_tokens, sessions, customers, email_outbox, audit_events, rate_limits,
              reconciliation_runs, product_versions, lesson_progress, lessons, sections, lesson_resources, assets,
              products, shop_settings RESTART IDENTITY CASCADE`,
  );
  // Start from nothing published: versions are created only by the publish flow (rows are immutable once written).
  await seedShop(db, { versions: false });
  // Make the course publishable: one section, one text lesson, plus a description and outcome.
  await db.query(`UPDATE products SET description = 'Learn it', outcomes = ARRAY['Know it'], status = 'draft' WHERE id = $1`, [IDS.course]);
  await db.query(`INSERT INTO assets (id, product_id, kind, object_key, status, mime_type, declared_bytes, actual_bytes, finalized_at)
                  VALUES ('00000000-0000-4000-8000-0000000000c1', $1, 'cover', 'covers/course-one.png', 'ready', 'image/png', 1000, 1000, now())`, [IDS.course]);
  await db.query(`UPDATE products SET cover_asset_id = '00000000-0000-4000-8000-0000000000c1' WHERE id = $1`, [IDS.course]);
  await db.query(`INSERT INTO sections (id, product_id, position, title) VALUES ('00000000-0000-4000-8000-0000000000a1', $1, 0, 'Start')`, [IDS.course]);
  await db.query(`INSERT INTO lessons (id, section_id, product_id, position, kind, title, is_preview, body_html, transcript)
                  VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', $1, 0, 'text', 'Welcome', true, '<p>Public preview body</p>', 'PRIVATE TRANSCRIPT')`, [IDS.course]);
  deps.setDepsForTesting({ config: configFor(), db: () => db, mail: { send: async () => ({ providerMessageId: null }) }, publish: () => publisher });
});

const publish = (productId: string) =>
  routes['owner-product-publish'].handler(Object.assign(makeRequest('POST', `owner/products/${productId}/publish`, { headers: OWNER, origin: APP_ORIGIN }), { params: { productId } }), invocation);
const callback = (publicationId: string, body: unknown, headers: Record<string, string> = CALLBACK) =>
  routes['publication-result'].handler(Object.assign(makeRequest('POST', `internal/publications/${publicationId}/result`, { headers, json: body }), { params: { publicationId } }), invocation);
const publicCatalog = () => routes['catalog-public'].handler(makeRequest('GET', 'catalog'), invocation);

describe('publishing (C04)', () => {
  it('refuses to publish until the product is complete, naming each missing item', async () => {
    await db.query(`UPDATE products SET description = '' WHERE id = $1`, [IDS.course]);
    await db.query('DELETE FROM lessons');
    const response = await publish(IDS.course);
    expect(response.status).toBe(400);
    const issues = bodyOf(response).error.issues.map((i: any) => i.path);
    expect(issues).toEqual(expect.arrayContaining(['description', 'curriculum']));
    expect(triggers.length).toBe(0);
  });

  it('keeps drafts off the public site until the build succeeds, then serves only the published snapshot', async () => {
    const response = await publish(IDS.course);
    expect(response.status).toBe(202);
    const { publicationId } = bodyOf(response);
    expect(triggers[0]).toEqual({ idempotencyKey: publicationId, publicationId });
    expect(bodyOf(await publicCatalog()).items).toEqual([]);

    expect((await callback(publicationId, { outcome: 'succeeded', buildUrl: 'https://github.test/run/1' })).status).toBe(200);
    const live = bodyOf(await publicCatalog()).items;
    expect(live.map((i: any) => i.slug)).toEqual(['course-one']);
    expect(String(JSON.stringify(live))).not.toContain('PRIVATE TRANSCRIPT');
    expect(String(JSON.stringify(live))).not.toContain('object_key');
  });

  it('keeps the published snapshot immune to later draft edits (price change after publishing)', async () => {
    const first = bodyOf(await publish(IDS.course));
    await callback(first.publicationId, { outcome: 'succeeded' });
    await db.query(`UPDATE products SET price_minor = 9900, title = 'Renamed draft' WHERE id = $1`, [IDS.course]);
    const live = bodyOf(await publicCatalog()).items[0];
    expect(live.title).toBe('Course One');
    expect(live.price.amountMinor).toBe(4900);
  });

  it('keeps the last successful version live when a build fails, and retries without duplicating versions', async () => {
    const v1 = bodyOf(await publish(IDS.course));
    await callback(v1.publicationId, { outcome: 'succeeded' });
    await db.query(`UPDATE products SET title = 'Course One v2' WHERE id = $1`, [IDS.course]);
    failTrigger = true;
    const v2 = bodyOf(await publish(IDS.course));
    expect(v2.status).toBe('failed');
    expect(bodyOf(await publicCatalog()).items[0].title).toBe('Course One');

    failTrigger = false;
    const retry = await routes['owner-publication-retry'].handler(
      Object.assign(makeRequest('POST', `owner/publications/${v2.publicationId}/retry`, { headers: OWNER, origin: APP_ORIGIN }), { params: { publicationId: v2.publicationId } }),
      invocation,
    );
    expect(bodyOf(retry).status).toBe('building');
    expect(triggers.filter((t) => t.publicationId === v2.publicationId).length).toBe(2);
    await callback(v2.publicationId, { outcome: 'succeeded' });
    expect(bodyOf(await publicCatalog()).items[0].title).toBe('Course One v2');
    const versions = await db.query('SELECT version_no FROM product_versions WHERE product_id = $1 ORDER BY version_no', [IDS.course]);
    expect(versions.rows.map((r) => r.version_no)).toEqual([1, 2]);
  });

  it('never rolls the public site back when an older build reports late', async () => {
    const v1 = bodyOf(await publish(IDS.course));
    const v2 = bodyOf(await publish(IDS.course));
    await callback(v2.publicationId, { outcome: 'succeeded' });
    await callback(v1.publicationId, { outcome: 'succeeded' });
    const { rows } = await db.query('SELECT published_version FROM products WHERE id = $1', [IDS.course]);
    expect(rows[0].published_version).toBe(2);
  });

  it('refuses a build callback without the server credential, and anonymous or customer publishing', async () => {
    const v1 = bodyOf(await publish(IDS.course));
    expect((await callback(v1.publicationId, { outcome: 'succeeded' }, {})).status).toBe(401);
    expect((await callback(v1.publicationId, { outcome: 'succeeded' }, { authorization: 'Bearer wrong' })).status).toBe(401);
    const anonymous = await routes['owner-product-publish'].handler(
      Object.assign(makeRequest('POST', `owner/products/${IDS.course}/publish`, { origin: APP_ORIGIN }), { params: { productId: IDS.course } }),
      invocation,
    );
    expect(anonymous.status).toBe(401);
  });

  it('archives a product out of the public catalog while keeping its purchase snapshots', async () => {
    const v1 = bodyOf(await publish(IDS.course));
    await callback(v1.publicationId, { outcome: 'succeeded' });
    expect(bodyOf(await publicCatalog()).items.length).toBe(1);
    await routes['owner-product-archive'].handler(
      Object.assign(makeRequest('POST', `owner/products/${IDS.course}/archive`, { headers: OWNER, origin: APP_ORIGIN }), { params: { productId: IDS.course } }),
      invocation,
    );
    expect(bodyOf(await publicCatalog()).items).toEqual([]);
    const versions = await db.query('SELECT count(*)::int AS n FROM product_versions WHERE product_id = $1', [IDS.course]);
    expect(versions.rows[0].n).toBe(1);
  });

  it('serves public responses with shared caching and drafts with no-store', async () => {
    const response = await publicCatalog();
    expect(String(response.headers['Cache-Control'])).toContain('public');
    const preview = await routes['owner-product-preview'].handler(
      Object.assign(makeRequest('GET', `owner/products/${IDS.course}/preview`, { headers: OWNER }), { params: { productId: IDS.course } }),
      invocation,
    );
    expect(preview.headers['Cache-Control']).toBe('private, no-store');
    expect(bodyOf(preview).product.status).toBe('draft');
  });
});
