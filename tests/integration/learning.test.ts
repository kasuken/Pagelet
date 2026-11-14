import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startPostgres, type TestDatabase } from '../helpers/postgres.js';
import { APP_ORIGIN, bodyOf, invocation, makeRequest } from '../helpers/api.js';
import { IDS, seedShop } from '../helpers/shop.js';

const LESSON = '00000000-0000-4000-8000-0000000000e1';
const SECTION = '00000000-0000-4000-8000-0000000000e2';
const VIDEO = '00000000-0000-4000-8000-0000000000e3';
const FILE = '00000000-0000-4000-8000-0000000000e4';
let server: TestDatabase;
let db: pg.Pool;
let routes: Record<string, { handler: (r: any, i: any) => Promise<any> }>;
let deps: { setDepsForTesting: (p: Record<string, unknown> | undefined) => void; loadConfig: (e: NodeJS.ProcessEnv) => any };
const blobReads: string[] = [];
const blob = {
  async issueReadUrl(key: string) {
    blobReads.push(key);
    return `https://storage.test/${key}?sig=fake`;
  },
  async issueUploadUrl() { return 'https://storage.test/upload'; },
  async inspect() { return null; },
  async delete() { return undefined; },
};

async function session(email: string): Promise<{ id: string; cookie: string }> {
  const { createSession } = await import('../../api/src/auth/session.js');
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const row = await c.query(`INSERT INTO customers (id, email_normalized) VALUES (gen_random_uuid(), $1)
                               ON CONFLICT (email_normalized) DO UPDATE SET email_normalized = EXCLUDED.email_normalized RETURNING id`, [email]);
    const token = (await createSession(c as any, row.rows[0].id)).token;
    await c.query('COMMIT');
    return { id: row.rows[0].id, cookie: `__Host-pagelet_session=${token}` };
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  server = await startPostgres(54_407);
  const url = await server.createMigrated('learning');
  db = new pg.Pool({ connectionString: url, max: 4 });
  const base = await import('../../api/src/functions/routes.js');
  const learning = await import('../../api/src/functions/learning.js');
  routes = { ...base.routes, ...learning.learningRoutes } as any;
  deps = {
    setDepsForTesting: (await import('../../api/src/core/deps.js')).setDepsForTesting as any,
    loadConfig: (await import('../../api/src/core/config.js')).loadConfig,
  };
  deps.setDepsForTesting({ config: deps.loadConfig({ APP_BASE_URL: APP_ORIGIN, DATABASE_URL: url } as NodeJS.ProcessEnv), db: () => db, blob: () => blob });
}, 180_000);

afterAll(async () => {
  deps?.setDepsForTesting(undefined);
  await db?.end();
  await server?.stop();
});

beforeEach(async () => {
  blobReads.length = 0;
  await db.query(
    `TRUNCATE lesson_progress, lesson_resources, lessons, sections, assets, webhook_events, refunds, order_items, orders, checkout_attempts,
              entitlement_grants, entitlements, free_claim_tokens, login_tokens, sessions, customers, email_outbox, audit_events, rate_limits,
              reconciliation_runs, publications, product_versions, products, shop_settings RESTART IDENTITY CASCADE`,
  );
  await seedShop(db);
  await db.query(`INSERT INTO sections (id, product_id, position, title) VALUES ($1, $2, 0, 'Module one')`, [SECTION, IDS.course]);
  await db.query(
    `INSERT INTO assets (id, product_id, kind, object_key, status, mime_type, declared_bytes, actual_bytes, finalized_at)
     VALUES ($1, $2, 'video', 'private/video.mp4', 'ready', 'video/mp4', 100, 100, now()),
            ($3, $2, 'file', 'private/guide.pdf', 'ready', 'application/pdf', 100, 100, now())`,
    [VIDEO, IDS.course, FILE],
  );
  await db.query(
    `INSERT INTO lessons (id, section_id, product_id, position, kind, title, body_html, transcript, video_asset_id)
     VALUES ($1, $2, $3, 0, 'video', 'Lesson A', '<p>Body</p>', 'Transcript text', $4)`,
    [LESSON, SECTION, IDS.course, VIDEO],
  );
  await db.query(`INSERT INTO lesson_resources (lesson_id, product_id, asset_id, position) VALUES ($1, $2, $3, 0)`, [LESSON, IDS.course, FILE]);
});

async function buy(customerId: string): Promise<void> {
  await db.query(`INSERT INTO entitlements (customer_id, product_id, status) VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING`, [customerId, IDS.course]);
  await db.query(`INSERT INTO entitlement_grants (id, customer_id, product_id, source) VALUES (gen_random_uuid(), $1, $2, 'complimentary')`, [customerId, IDS.course]);
}

const withParams = (method: string, path: string, params: Record<string, string>, opts: any = {}) =>
  Object.assign(makeRequest(method, path, opts), { params });

describe('learning access (A03, L02, L03, L04)', () => {
  it('lets a buyer open their lesson and its curriculum, and refuses a stranger the same lesson ID', async () => {
    const buyer = await session('learner@example.test');
    const stranger = await session('stranger@example.test');
    await buy(buyer.id);
    const ok = await routes['lesson-get'].handler(withParams('GET', `lessons/${LESSON}`, { lessonId: LESSON }, { headers: { cookie: buyer.cookie } }), invocation);
    expect(ok.status).toBe(200);
    expect(bodyOf(ok).transcript).toBe('Transcript text');
    expect(ok.headers['Cache-Control']).toBe('private, no-store');
    const denied = await routes['lesson-get'].handler(withParams('GET', `lessons/${LESSON}`, { lessonId: LESSON }, { headers: { cookie: stranger.cookie } }), invocation);
    expect(denied.status).toBe(404);
    const curriculum = await routes['library-curriculum'].handler(withParams('GET', 'library/products/course-one/curriculum', { slug: 'course-one' }, { headers: { cookie: buyer.cookie } }), invocation);
    expect(bodyOf(curriculum).sections[0].lessons[0].title).toBe('Lesson A');
  });

  it('issues short-lived playback and download links only while entitled, and refuses them after revocation', async () => {
    const buyer = await session('refresh@example.test');
    await buy(buyer.id);
    const play = await routes['lesson-playback'].handler(withParams('GET', `lessons/${LESSON}/playback`, { lessonId: LESSON }, { headers: { cookie: buyer.cookie } }), invocation);
    expect(bodyOf(play).url).toContain('private/video.mp4');
    const dl = await routes['asset-download'].handler(withParams('GET', `assets/${FILE}/download`, { assetId: FILE }, { headers: { cookie: buyer.cookie } }), invocation);
    expect(bodyOf(dl).url).toContain('private/guide.pdf');
    expect(blobReads.length).toBe(2);

    await db.query(`UPDATE entitlement_grants SET status = 'revoked' WHERE customer_id = $1`, [buyer.id]);
    await db.query(`UPDATE entitlements SET status = 'revoked' WHERE customer_id = $1`, [buyer.id]);
    const refused = await routes['lesson-playback'].handler(withParams('GET', `lessons/${LESSON}/playback`, { lessonId: LESSON }, { headers: { cookie: buyer.cookie } }), invocation);
    expect(refused.status).toBe(404);
    const refusedDl = await routes['asset-download'].handler(withParams('GET', `assets/${FILE}/download`, { assetId: FILE }, { headers: { cookie: buyer.cookie } }), invocation);
    expect(refusedDl.status).toBe(404);
  });

  it('bounds resume positions and keeps completion explicit', async () => {
    const buyer = await session('progress@example.test');
    await buy(buyer.id);
    const headers = { cookie: buyer.cookie, origin: APP_ORIGIN };
    const save = (body: unknown) => routes['lesson-progress'].handler(withParams('PUT', `lessons/${LESSON}/progress`, { lessonId: LESSON }, { headers, json: body }), invocation);
    expect((await save({ resumeSeconds: 125 })).status).toBe(200);
    expect((await save({ resumeSeconds: 99999999 })).status).toBe(400);
    expect((await save({ resumeSeconds: -5 })).status).toBe(400);
    await save({ resumeSeconds: 130, completed: true });
    let row = (await db.query('SELECT resume_seconds, completed_at FROM lesson_progress WHERE customer_id = $1', [buyer.id])).rows[0];
    expect(row.resume_seconds).toBe(130);
    expect(row.completed_at).not.toBeNull();
    // A later position save must not clear completion.
    await save({ resumeSeconds: 10 });
    row = (await db.query('SELECT completed_at FROM lesson_progress WHERE customer_id = $1', [buyer.id])).rows[0];
    expect(row.completed_at).not.toBeNull();
  });

  it('lists the ready files of a purchased product only to its buyer', async () => {
    const buyer = await session('files-buyer@example.test');
    const stranger = await session('files-stranger@example.test');
    await buy(buyer.id);
    const files = await routes['library-files'].handler(
      Object.assign(makeRequest('GET', 'library/products/course-one/files', { headers: { cookie: buyer.cookie } }), { params: { slug: 'course-one' } }),
      invocation,
    );
    expect(files.status).toBe(200);
    expect(bodyOf(files).files.map((f: any) => f.assetId)).toEqual([FILE]);
    const denied = await routes['library-files'].handler(
      Object.assign(makeRequest('GET', 'library/products/course-one/files', { headers: { cookie: stranger.cookie } }), { params: { slug: 'course-one' } }),
      invocation,
    );
    expect(denied.status).toBe(404);
  });
});
