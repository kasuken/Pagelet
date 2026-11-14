import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, body, seedShop, publishedDownload, seedPurchase, readyAsset, type Harness } from '../helpers/catalog.js';
import { PDF_HEAD } from '../helpers/blob.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness(54_410, 'catalog_products');
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await h.db.query('TRUNCATE shop_settings, products, product_versions, sections, lessons, lesson_resources, assets, customers, checkout_attempts, orders, order_items, entitlement_grants, entitlements, audit_events, publications RESTART IDENTITY CASCADE');
  h.blob.objects.clear();
  h.blob.deleted.length = 0;
});

const revisionOf = async (id: string) => (await h.db.query<{ revision: number }>('SELECT revision FROM products WHERE id = $1', [id])).rows[0]!.revision;

const createDraft = (slug: string, extra: Record<string, unknown> = {}) =>
  h.owner('owner-products-create', 'POST', 'owner/products', {
    json: { title: `Product ${slug}`, slug, productType: 'course', description: 'desc', priceMinor: 1500, ...extra },
  });

describe('product catalog (C01)', () => {
  it('requires the shop currency before products exist', async () => {
    const res = await createDraft('needs-shop');
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('conflict');
  });

  it('creates, reads, lists and updates both course and download products with shared validation', async () => {
    await seedShop(h);
    const course = await body((await createDraft('intro-course')));
    expect(course.product).toMatchObject({ slug: 'intro-course', productType: 'course', status: 'draft', price: { amountMinor: 1500, currency: 'EUR' }, revision: 1 });
    const download = await body(await h.owner('owner-products-create', 'POST', 'owner/products', { json: { title: 'Toolkit', slug: 'toolkit', productType: 'download', priceMinor: 900 } }));
    expect(download.product.productType).toBe('download');

    const list = await body(await h.owner('owner-products-list', 'GET', 'owner/products'));
    expect(list.products.map((p: any) => p.slug).sort()).toEqual(['intro-course', 'toolkit']);

    const bad = await createDraft('Bad Slug!');
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).error.issues[0].path).toBe('slug');

    const patched = await h.owner('owner-product-update', 'PATCH', `owner/products/${course.product.id}`, {
      params: { id: course.product.id },
      json: { revision: 1, title: 'Intro course, revised', outcomes: ['Ship a page'] },
    });
    expect(patched.status).toBe(200);
    expect((await body(patched)).product).toMatchObject({ title: 'Intro course, revised', outcomes: ['Ship a page'], revision: 2 });
  });

  it('returns a field-level 409 on slug collision, on create and on rename', async () => {
    await seedShop(h);
    await createDraft('taken');
    const dup = await createDraft('taken');
    expect(dup.status).toBe(409);
    expect(JSON.parse(dup.body).error.issues).toEqual([expect.objectContaining({ path: 'slug' })]);

    const other = await body(await createDraft('other'));
    const rename = await h.owner('owner-product-update', 'PATCH', `owner/products/${other.product.id}`, {
      params: { id: other.product.id },
      json: { revision: 1, slug: 'taken' },
    });
    expect(rename.status).toBe(409);
    expect(JSON.parse(rename.body).error.issues[0].path).toBe('slug');
  });

  it('refuses a stale save with 409 and leaves the stored product unchanged', async () => {
    await seedShop(h);
    const p = (await body(await createDraft('stale'))).product;
    const first = await h.owner('owner-product-update', 'PATCH', `owner/products/${p.id}`, { params: { id: p.id }, json: { revision: 1, title: 'Edit A' } });
    expect(first.status).toBe(200);
    const stale = await h.owner('owner-product-update', 'PATCH', `owner/products/${p.id}`, { params: { id: p.id }, json: { revision: 1, title: 'Edit B' } });
    expect(stale.status).toBe(409);
    expect(JSON.parse(stale.body).error.message).toMatch(/changed since you opened it/);
    const { rows } = await h.db.query('SELECT title FROM products WHERE id = $1', [p.id]);
    expect(rows[0].title).toBe('Edit A');
  });

  it('deletes a never-sold draft, and refuses deletion of a published product', async () => {
    await seedShop(h);
    const draft = (await body(await createDraft('scratch'))).product;
    const gone = await h.owner('owner-product-delete', 'DELETE', `owner/products/${draft.id}?revision=1`, { params: { id: draft.id } });
    expect(gone.status).toBe(204);

    const pub = await publishedDownload(h, 'published-one');
    const refused = await h.owner('owner-product-delete', 'DELETE', `owner/products/${pub.productId}?revision=${await revisionOf(pub.productId)}`, { params: { id: pub.productId } });
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body).error.message).toMatch(/Archive/);
  });

  it('archives instead of deleting a sold product and keeps the purchase intact', async () => {
    await seedShop(h);
    const pub = await publishedDownload(h, 'sold-one');
    await seedPurchase(h, { email: 'buyer@example.test', productId: pub.productId });

    const del = await h.owner('owner-product-delete', 'DELETE', `owner/products/${pub.productId}?revision=${await revisionOf(pub.productId)}`, { params: { id: pub.productId } });
    expect(del.status).toBe(409);
    expect(JSON.parse(del.body).error.message).toMatch(/Archive/);

    const { rows } = await h.db.query('SELECT count(*)::int AS n FROM order_items WHERE product_id = $1', [pub.productId]);
    expect(rows[0].n).toBe(1);
    const { rows: [ent] } = await h.db.query(`SELECT status FROM entitlements WHERE product_id = $1`, [pub.productId]);
    expect(ent.status).toBe('active');
  });

  it('keeps a published price snapshot when the price later changes, and the version row is immutable', async () => {
    await seedShop(h);
    const pub = await publishedDownload(h, 'priced', 1000);
    const { rows: [v1] } = await h.db.query(`SELECT snapshot FROM product_versions WHERE product_id = $1 AND version_no = 1`, [pub.productId]);
    expect(v1.snapshot.priceMinor).toBe(1000);

    const { rows: [current] } = await h.db.query(`SELECT revision FROM products WHERE id = $1`, [pub.productId]);
    const repriced = await h.owner('owner-product-update', 'PATCH', `owner/products/${pub.productId}`, {
      params: { id: pub.productId },
      json: { revision: current.revision, priceMinor: 2000, title: 'Renamed after launch' },
    });
    expect(repriced.status).toBe(200);
    expect((await body(repriced)).product.price.amountMinor).toBe(2000);

    const { rows: [v1After] } = await h.db.query(`SELECT snapshot FROM product_versions WHERE product_id = $1 AND version_no = 1`, [pub.productId]);
    expect(v1After.snapshot.priceMinor).toBe(1000);
    expect(v1After.snapshot.title).toBe('PDF guide');
    await expect(h.db.query(`UPDATE product_versions SET snapshot = '{}'::jsonb WHERE product_id = $1`, [pub.productId])).rejects.toThrow(/immutable/);
    await expect(h.db.query(`DELETE FROM product_versions WHERE product_id = $1`, [pub.productId])).rejects.toThrow(/immutable/);
  });

  it('refuses edits to an archived product and never lets the editor set status', async () => {
    await seedShop(h);
    const pub = await publishedDownload(h, 'to-archive');
    // Archiving goes through the publication flow (requestPublication with reason archive).
    const { requestPublication } = await import('../../api/src/services/publication.js');
    const { getDeps } = await import('../../api/src/core/deps.js');
    const { createLogger } = await import('../../api/src/core/logger.js');
    await requestPublication(getDeps(), createLogger(() => undefined), { productId: pub.productId, reason: 'archive', actor: 'owner' });
    const edit = await h.owner('owner-product-update', 'PATCH', `owner/products/${pub.productId}`, {
      params: { id: pub.productId },
      json: { revision: await revisionOf(pub.productId), title: 'nope' },
    });
    expect(edit.status).toBe(409);
    expect(JSON.parse(edit.body).error.message).toMatch(/read-only/);
    const { rows: [after] } = await h.db.query(`SELECT status FROM products WHERE id = $1`, [pub.productId]);
    expect(after.status).toBe('archived');
  });

  it('shows owner detail with the publish checklist and no storage keys', async () => {
    await seedShop(h);
    const p = (await body(await createDraft('detail'))).product;
    const detail = await body(await h.owner('owner-product-get', 'GET', `owner/products/${p.id}`, { params: { id: p.id } }));
    expect(detail.product.publishReadiness.map((i: any) => i.path)).toContain('coverAssetId');
    expect(JSON.stringify(detail)).not.toMatch(/object_key|objectKey|blob\.test/);
  });

  it('keeps a cover asset only from the same product (composite key) and rejects a foreign cover', async () => {
    await seedShop(h);
    const a = (await body(await createDraft('cover-a'))).product;
    const b = (await body(await createDraft('cover-b'))).product;
    const coverB = await readyAsset(h, { kind: 'cover', productId: b.id, mimeType: 'image/png', bytes: 1024, head: '\u0089PNG\r\n\u001a\nfixture' });
    const res = await h.owner('owner-product-update', 'PATCH', `owner/products/${a.id}`, { params: { id: a.id }, json: { revision: 1, coverAssetId: coverB.id } });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error.issues[0].path).toBe('coverAssetId');
    void PDF_HEAD;
  });
});
