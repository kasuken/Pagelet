import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, body, seedShop, readyAsset, seedPurchase, type Harness } from '../helpers/catalog.js';
import { MP4_HEAD, VTT_HEAD, PNG_HEAD, PDF_HEAD } from '../helpers/blob.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness(54_411, 'catalog_curriculum');
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await h.db.query('TRUNCATE shop_settings, products, product_versions, sections, lessons, lesson_resources, assets, customers, checkout_attempts, orders, order_items, entitlement_grants, entitlements, lesson_progress, audit_events, publications RESTART IDENTITY CASCADE');
  h.blob.objects.clear();
  h.blob.deleted.length = 0;
});

async function course(slug = 'course') {
  await seedShop(h);
  const p = (await body(await h.owner('owner-products-create', 'POST', 'owner/products', { json: { title: 'Course', slug, productType: 'course', description: 'desc', outcomes: ['Outcome'], priceMinor: 500 } }))).product;
  return p as { id: string; revision: number };
}

const section = async (productId: string, title: string) => body(await h.owner('owner-section-create', 'POST', `owner/products/${productId}/sections`, { params: { id: productId }, json: { title } }));
const lesson = (sectionId: string, json: Record<string, unknown>) => h.owner('owner-lesson-create', 'POST', `owner/sections/${sectionId}/lessons`, { params: { id: sectionId }, json });

describe('curriculum editor (C02)', () => {
  it('creates ordered sections and lessons with explicit preview flags, and reorders the full list in one transaction', async () => {
    const p = await course('ordered');
    const s1 = (await section(p.id, 'One')).section;
    const s2 = (await section(p.id, 'Two')).section;
    expect([s1.position, s2.position]).toEqual([0, 1]);

    const a = (await body(await lesson(s1.id, { title: 'A', kind: 'text', bodyHtml: '<p>a</p>', isPreview: true }))).lesson;
    const b = (await body(await lesson(s1.id, { title: 'B', kind: 'text', bodyHtml: '<p>b</p>' }))).lesson;
    const c = (await body(await lesson(s1.id, { title: 'C', kind: 'text', bodyHtml: '<p>c</p>' }))).lesson;

    // Move C up to the front: full ordered list, positions swap inside deferrable unique constraints.
    const reorder = await h.owner('owner-lessons-reorder', 'POST', `owner/sections/${s1.id}/lessons/reorder`, { params: { id: s1.id }, json: { ids: [c.id, a.id, b.id] } });
    expect(reorder.status).toBe(200);
    const detail = (await body(await h.owner('owner-product-get', 'GET', `owner/products/${p.id}`, { params: { id: p.id } }))).product;
    expect(detail.sections[0].lessons.map((l: any) => l.title)).toEqual(['C', 'A', 'B']);
    expect(detail.sections[0].lessons.find((l: any) => l.title === 'A').isPreview).toBe(true);

    const swapSections = await h.owner('owner-sections-reorder', 'POST', `owner/products/${p.id}/sections/reorder`, { params: { id: p.id }, json: { ids: [s2.id, s1.id] } });
    expect(swapSections.status).toBe(200);
    const after = (await body(await h.owner('owner-product-get', 'GET', `owner/products/${p.id}`, { params: { id: p.id } }))).product;
    expect(after.sections.map((s: any) => s.title)).toEqual(['Two', 'One']);
  });

  it('refuses a stale reorder list with 409 and changes nothing', async () => {
    const p = await course('stale-order');
    const s1 = (await section(p.id, 'One')).section;
    await section(p.id, 'Two');
    const res = await h.owner('owner-sections-reorder', 'POST', `owner/products/${p.id}/sections/reorder`, { params: { id: p.id }, json: { ids: [s1.id] } });
    expect(res.status).toBe(409);
    const { rows } = await h.db.query('SELECT position FROM sections WHERE id = $1', [s1.id]);
    expect(rows[0].position).toBe(0);
  });

  it('sanitizes malicious lesson HTML before storage and never stores scripts, handlers or unsafe links', async () => {
    const p = await course('malicious');
    const s = (await section(p.id, 'S')).section;
    const res = await lesson(s.id, {
      title: 'Bad content',
      kind: 'text',
      bodyHtml: '<h2>Ok</h2><script>alert(1)</script><p onclick="x()">hi <a href="javascript:alert(1)">bad</a> <a href="https://example.test/ok">good</a></p><iframe src="https://evil.test"></iframe><img src=x onerror=alert(2)>',
    });
    expect(res.status).toBe(201);
    const { rows: [row] } = await h.db.query(`SELECT body_html FROM lessons WHERE id = $1`, [(await body(res)).lesson.id]);
    expect(row.body_html).not.toMatch(/<script|<iframe|<img|onclick|onerror|javascript:/i);
    expect(row.body_html).toContain('<h2>Ok</h2>');
    expect(row.body_html).toContain('href="https://example.test/ok"');
  });

  it('refuses a resource that belongs to another product with a 400 validation error, never a 500', async () => {
    const a = await course('resource-a');
    await seedShop(h).catch(() => undefined);
    const b = (await body(await h.owner('owner-products-create', 'POST', 'owner/products', { json: { title: 'B', slug: 'resource-b', productType: 'download', description: 'd', outcomes: ['o'], priceMinor: 0 } }))).product;
    const foreign = await readyAsset(h, { kind: 'file', productId: b.id, mimeType: 'application/pdf', bytes: 100, head: PDF_HEAD });
    const s = (await section(a.id, 'S')).section;
    const res = await lesson(s.id, { title: 'Text', kind: 'text', bodyHtml: '<p>x</p>', resourceAssetIds: [foreign.id] });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error.issues[0].path).toBe('resourceAssetIds');
  });

  it('accepts an own-product resource and refuses one that is not a downloadable file', async () => {
    const a = await course('resource-own');
    const own = await readyAsset(h, { kind: 'file', productId: a.id, mimeType: 'application/pdf', bytes: 100, head: PDF_HEAD });
    const s = (await section(a.id, 'S')).section;
    const ok = await lesson(s.id, { title: 'Text', kind: 'text', bodyHtml: '<p>x</p>', resourceAssetIds: [own.id] });
    expect(ok.status).toBe(201);
    const cover = await readyAsset(h, { kind: 'cover', productId: a.id, mimeType: 'image/png', bytes: 100, head: PNG_HEAD });
    const wrong = await lesson(s.id, { title: 'Bad', kind: 'text', bodyHtml: '', resourceAssetIds: [cover.id] });
    expect(wrong.status).toBe(400);
  });

  it('reports every missing video-lesson item at publication time, and a fully prepared video lesson publishes', async () => {
    const p = await course('video-ready');
    const s = (await section(p.id, 'S')).section;
    const created = await body(await lesson(s.id, { title: 'Video', kind: 'video', bodyHtml: '', isPreview: false }));
    const detailBefore = (await body(await h.owner('owner-product-get', 'GET', `owner/products/${p.id}`, { params: { id: p.id } }))).product;
    const paths = detailBefore.publishReadiness.map((i: any) => i.path);
    expect(paths).toContain(`lessons.${created.lesson.id}.videoAssetId`);
    expect(paths).toContain(`lessons.${created.lesson.id}.captionAssetId`);
    expect(paths).toContain(`lessons.${created.lesson.id}.transcript`);

    const video = await readyAsset(h, { kind: 'video', productId: p.id, mimeType: 'video/mp4', bytes: 5000, head: MP4_HEAD });
    const captions = await readyAsset(h, { kind: 'caption', productId: p.id, mimeType: 'text/vtt', bytes: 40, head: VTT_HEAD });
    const cover = await readyAsset(h, { kind: 'cover', productId: p.id, mimeType: 'image/png', bytes: 100, head: PNG_HEAD });
    await h.owner('owner-lesson-update', 'PATCH', `owner/lessons/${created.lesson.id}`, {
      params: { id: created.lesson.id },
      json: { videoAssetId: video.id, captionAssetId: captions.id, transcript: 'Spoken words.' },
    });
    await h.owner('owner-product-update', 'PATCH', `owner/products/${p.id}`, { params: { id: p.id }, json: { revision: p.revision, coverAssetId: cover.id } });
    const { requestPublication } = await import('../../api/src/services/publication.js');
    const { getDeps } = await import('../../api/src/core/deps.js');
    const { createLogger } = await import('../../api/src/core/logger.js');
    const pub = await requestPublication(getDeps(), createLogger(() => undefined), { productId: p.id, reason: 'publish', actor: 'owner' });
    expect(pub.versionNo).toBe(1);
  });

  it('keeps a lesson with learner progress from being removed, and refuses removing a section that still has lessons', async () => {
    const p = await course('guarded');
    const s = (await section(p.id, 'S')).section;
    const created = await lesson(s.id, { title: 'T', kind: 'text', bodyHtml: '<p>t</p>' });
    expect(created.status, created.body).toBe(201);
    const l = (await body(created)).lesson;
    const refuse = await h.owner('owner-section-delete', 'DELETE', `owner/sections/${s.id}`, { params: { id: s.id } });
    expect(refuse.status).toBe(409);

    const { customerId } = await seedPurchase(h, { email: 'learner@example.test', productId: p.id });
    await h.db.query(`INSERT INTO lesson_progress (customer_id, lesson_id, resume_seconds) VALUES ($1, $2, 30)`, [customerId, l.id]);
    const del = await h.owner('owner-lesson-delete', 'DELETE', `owner/lessons/${l.id}`, { params: { id: l.id } });
    expect(del.status).toBe(409);
  });

  it('refuses a video lesson that points at a caption asset', async () => {
    const p = await course('kind-check');
    const s = (await section(p.id, 'S')).section;
    const caption = await readyAsset(h, { kind: 'caption', productId: p.id, mimeType: 'text/vtt', bytes: 40, head: VTT_HEAD });
    const res = await lesson(s.id, { title: 'V', kind: 'video', videoAssetId: caption.id });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error.issues[0].path).toBe('videoAssetId');
  });
});
