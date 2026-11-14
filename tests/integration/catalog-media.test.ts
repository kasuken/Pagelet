import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, body, seedShop, readyAsset, publishedDownload, seedPurchase, type Harness } from '../helpers/catalog.js';
import { PDF_HEAD, ZIP_HEAD, MP4_HEAD, VTT_HEAD } from '../helpers/blob.js';
import { issueDownloadUrl, issuePlaybackUrl, recordResumePosition, downloadFilename } from '../../api/src/services/media.js';
import { getDeps } from '../../api/src/core/deps.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness(54_412, 'catalog_media', { MEDIA_QUOTA_BYTES: '1000000' });
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await h.db.query('TRUNCATE shop_settings, products, product_versions, sections, lessons, lesson_resources, assets, customers, checkout_attempts, orders, order_items, entitlement_grants, entitlements, lesson_progress, audit_events, publications RESTART IDENTITY CASCADE');
  h.blob.objects.clear();
  h.blob.deleted.length = 0;
  h.blob.uploadUrls.length = 0;
  h.blob.readUrls.length = 0;
  await h.setConfig({ MEDIA_QUOTA_BYTES: '1000000' });
});

async function product(slug: string, productType: 'course' | 'download' = 'download') {
  await seedShop(h);
  const res = await h.owner('owner-products-create', 'POST', 'owner/products', { json: { title: slug, slug, productType, description: 'd', outcomes: ['o'], priceMinor: 100 } });
  return (await body(res)).product as { id: string; revision: number };
}

const requestUpload = (json: Record<string, unknown>) => h.owner('owner-upload-create', 'POST', 'owner/media/uploads', { json });
const finalize = (id: string) => h.owner('owner-upload-finalize', 'POST', `owner/media/uploads/${id}/finalize`, { params: { id } });
async function keyOf(id: string) {
  return (await h.db.query<{ object_key: string }>('SELECT object_key FROM assets WHERE id = $1', [id])).rows[0]!.object_key;
}

describe('owner direct uploads (M01)', () => {
  it('issues a blob-specific write URL with a server-derived key and never returns the key', async () => {
    const p = await product('upload-ok');
    const res = await requestUpload({ kind: 'file', productId: p.id, mimeType: 'application/pdf', declaredBytes: 4096 });
    expect(res.status).toBe(201);
    const data = await body(res);
    expect(data.asset.status).toBe('pending_upload');
    expect(data.upload.url).toContain('sp=cw');
    expect(data.upload.headers['Content-Type']).toBe('application/pdf');
    expect(JSON.stringify(data)).not.toContain('object_key');
    expect(await keyOf(data.asset.id)).toMatch(new RegExp(`^file/${p.id}/${data.asset.id}$`));
  });

  it('rejects executables, active HTML and SVG and over-limit sizes before any URL is issued', async () => {
    const p = await product('upload-reject');
    for (const mimeType of ['application/x-msdownload', 'text/html', 'image/svg+xml', 'application/javascript']) {
      const res = await requestUpload({ kind: 'file', productId: p.id, mimeType, declaredBytes: 100 });
      expect(res.status, mimeType).toBe(400);
      expect(JSON.parse(res.body).error.issues[0].path).toBe('mimeType');
    }
    const huge = await requestUpload({ kind: 'cover', productId: p.id, mimeType: 'image/png', declaredBytes: 50 * 1024 * 1024 });
    expect(huge.status).toBe(400);
    expect(JSON.parse(huge.body).error.issues[0].path).toBe('declaredBytes');
    expect(h.blob.uploadUrls.length).toBe(0);
  });

  it('keeps logos product-less and everything else product-bound', async () => {
    const p = await product('scope');
    expect((await requestUpload({ kind: 'logo', productId: p.id, mimeType: 'image/png', declaredBytes: 100 })).status).toBe(400);
    expect((await requestUpload({ kind: 'file', mimeType: 'application/pdf', declaredBytes: 100 })).status).toBe(400);
    expect((await requestUpload({ kind: 'logo', mimeType: 'image/png', declaredBytes: 100 })).status).toBe(201);
  });

  it('refuses an upload that would exceed the storage quota, on issuance', async () => {
    const p = await product('quota-issue');
    await h.setConfig({ MEDIA_QUOTA_BYTES: '5000' });
    expect((await requestUpload({ kind: 'file', productId: p.id, mimeType: 'application/pdf', declaredBytes: 4000 })).status).toBe(201);
    const refused = await requestUpload({ kind: 'file', productId: p.id, mimeType: 'application/pdf', declaredBytes: 4000 });
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body).error.message).toMatch(/quota/i);
  });

  it('finalizes a valid object to ready and stores the actual size', async () => {
    const p = await product('final-ok');
    const asset = await readyAsset(h, { kind: 'file', productId: p.id, mimeType: 'application/pdf', bytes: 4096, head: PDF_HEAD });
    expect(asset).toMatchObject({ status: 'ready', actualBytes: 4096 });
  });

  it('forged or mismatched finalization rejects the asset and deletes the blob', async () => {
    const p = await product('forged');
    const cases: Array<{ name: string; mime: string; declared: number; stored: { mime: string; bytes: number; head: string } }> = [
      { name: 'size', mime: 'application/pdf', declared: 4096, stored: { mime: 'application/pdf', bytes: 999999, head: PDF_HEAD } },
      { name: 'content type', mime: 'application/pdf', declared: 4096, stored: { mime: 'text/html', bytes: 4096, head: PDF_HEAD } },
      { name: 'signature', mime: 'application/pdf', declared: 4096, stored: { mime: 'application/pdf', bytes: 4096, head: '<html><script>x</script>' } },
    ];
    for (const c of cases) {
      const created = await requestUpload({ kind: 'file', productId: p.id, mimeType: c.mime, declaredBytes: c.declared });
      const { asset, upload } = await body(created);
      const key = await keyOf(asset.id);
      h.blob.store(key, c.stored.mime, c.stored.head, c.stored.bytes);
      const res = await finalize(asset.id);
      expect(res.status, c.name).toBe(400);
      const { rows: [row] } = await h.db.query('SELECT status FROM assets WHERE id = $1', [asset.id]);
      expect(row.status, c.name).toBe('rejected');
      expect(h.blob.deleted, c.name).toContain(key);
      expect(h.blob.objects.has(key), c.name).toBe(false);
      void upload;
    }
  });

  it('refuses to finalize an object that never arrived, without rejecting the owner\'s upload', async () => {
    const p = await product('not-arrived');
    const { asset } = await body(await requestUpload({ kind: 'file', productId: p.id, mimeType: 'application/pdf', declaredBytes: 10 }));
    const res = await finalize(asset.id);
    expect(res.status).toBe(409);
    const { rows: [row] } = await h.db.query('SELECT status FROM assets WHERE id = $1', [asset.id]);
    expect(row.status).toBe('pending_upload');
  });

  it('refuses a second finalize of a ready asset', async () => {
    const p = await product('twice');
    const asset = await readyAsset(h, { kind: 'file', productId: p.id, mimeType: 'application/pdf', bytes: 100, head: PDF_HEAD });
    expect((await finalize(asset.id)).status).toBe(409);
  });

  it('accepts a ZIP without extracting it and validates WebVTT captions by header and size', async () => {
    const p = await product('zip-vtt', 'course');
    const zip = await readyAsset(h, { kind: 'file', productId: p.id, mimeType: 'application/zip', bytes: 300, head: ZIP_HEAD });
    expect(zip.status).toBe('ready');
    const badVtt = await requestUpload({ kind: 'caption', productId: p.id, mimeType: 'text/vtt', declaredBytes: 20 });
    const { asset } = await body(badVtt);
    h.blob.store(await keyOf(asset.id), 'text/vtt', 'not a caption file', 20);
    expect((await finalize(asset.id)).status).toBe(400);
    const tooBig = await requestUpload({ kind: 'caption', productId: p.id, mimeType: 'text/vtt', declaredBytes: 2 * 1024 * 1024 });
    expect(tooBig.status).toBe(400);
    const good = await readyAsset(h, { kind: 'caption', productId: p.id, mimeType: 'text/vtt', bytes: VTT_HEAD.length, head: VTT_HEAD });
    expect(good.status).toBe('ready');
  });

  it('aborts an unfinished upload and removes its blob and row; refuses to abort a ready asset', async () => {
    const p = await product('abort');
    const { asset } = await body(await requestUpload({ kind: 'file', productId: p.id, mimeType: 'application/pdf', declaredBytes: 10 }));
    const key = await keyOf(asset.id);
    h.blob.store(key, 'application/pdf', PDF_HEAD, 10);
    const del = await h.owner('owner-upload-abort', 'DELETE', `owner/media/uploads/${asset.id}`, { params: { id: asset.id } });
    expect(del.status).toBe(204);
    expect(h.blob.deleted).toContain(key);
    const { rows } = await h.db.query('SELECT count(*)::int AS n FROM assets WHERE id = $1', [asset.id]);
    expect(rows[0].n).toBe(0);

    const ready = await readyAsset(h, { kind: 'file', productId: p.id, mimeType: 'application/pdf', bytes: 100, head: PDF_HEAD });
    expect((await h.owner('owner-upload-abort', 'DELETE', `owner/media/uploads/${ready.id}`, { params: { id: ready.id } })).status).toBe(409);
  });

  it('replaces a file by creating a new row that points at the old one; the old object stays ready', async () => {
    const p = await product('replace');
    const v1 = await readyAsset(h, { kind: 'file', productId: p.id, mimeType: 'application/pdf', bytes: 100, head: PDF_HEAD, versionLabel: 'v1' });
    const v2 = await readyAsset(h, { kind: 'file', productId: p.id, mimeType: 'application/pdf', bytes: 200, head: PDF_HEAD, versionLabel: 'v2', replacesAssetId: v1.id });
    expect(v2.id).not.toBe(v1.id);
    const { rows } = await h.db.query('SELECT id, status, replaces_asset_id FROM assets WHERE product_id = $1 ORDER BY created_at', [p.id]);
    expect(rows.find((r: any) => r.id === v1.id).status).toBe('ready');
    expect(rows.find((r: any) => r.id === v2.id).replaces_asset_id).toBe(v1.id);
  });
});

describe('deletion and cleanup (M04)', () => {
  it('refuses to delete a ready file used by a lesson, and refuses to delete any file of a sold product', async () => {
    const p = await product('used', 'course');
    const sectionRes = await body(await h.owner('owner-section-create', 'POST', `owner/products/${p.id}/sections`, { params: { id: p.id }, json: { title: 'S' } }));
    const video = await readyAsset(h, { kind: 'video', productId: p.id, mimeType: 'video/mp4', bytes: 5000, head: MP4_HEAD });
    await h.owner('owner-lesson-create', 'POST', `owner/sections/${sectionRes.section.id}/lessons`, { params: { id: sectionRes.section.id }, json: { title: 'V', kind: 'video', videoAssetId: video.id } });
    const refused = await h.owner('owner-asset-delete', 'DELETE', `owner/media/assets/${video.id}`, { params: { id: video.id } });
    expect(refused.status).toBe(409);

    const sold = await publishedDownload(h, 'sold-files');
    await seedPurchase(h, { email: 'buyer@example.test', productId: sold.productId });
    const soldDel = await h.owner('owner-asset-delete', 'DELETE', `owner/media/assets/${sold.fileId}`, { params: { id: sold.fileId } });
    expect(soldDel.status).toBe(409);
    expect(JSON.parse(soldDel.body).error.message).toMatch(/sold/);
  });

  it('deletes an unused ready file of an unsold draft and removes its blob', async () => {
    const p = await product('unsold');
    const f = await readyAsset(h, { kind: 'file', productId: p.id, mimeType: 'application/pdf', bytes: 100, head: PDF_HEAD });
    const key = await keyOf(f.id);
    expect((await h.owner('owner-asset-delete', 'DELETE', `owner/media/assets/${f.id}`, { params: { id: f.id } })).status).toBe(204);
    expect(h.blob.deleted).toContain(key);
  });

  it('requires explicit confirmation, deletes only rejected and abandoned unfinished uploads, and never a referenced ready asset', async () => {
    const p = await product('cleanup', 'course');
    const sec = await body(await h.owner('owner-section-create', 'POST', `owner/products/${p.id}/sections`, { params: { id: p.id }, json: { title: 'S' } }));
    const video = await readyAsset(h, { kind: 'video', productId: p.id, mimeType: 'video/mp4', bytes: 5000, head: MP4_HEAD });
    await h.owner('owner-lesson-create', 'POST', `owner/sections/${sec.section.id}/lessons`, { params: { id: sec.section.id }, json: { title: 'V', kind: 'video', videoAssetId: video.id } });
    // A rejected upload and an abandoned pending upload, both old.
    const rej = await body(await requestUpload({ kind: 'file', productId: p.id, mimeType: 'application/pdf', declaredBytes: 10 }));
    await h.db.query(`UPDATE assets SET status = 'rejected', created_at = now() - interval '3 days' WHERE id = $1`, [rej.asset.id]);
    const pend = await body(await requestUpload({ kind: 'file', productId: p.id, mimeType: 'application/pdf', declaredBytes: 10 }));
    await h.db.query(`UPDATE assets SET created_at = now() - interval '3 days' WHERE id = $1`, [pend.asset.id]);
    h.blob.store(await keyOf(pend.asset.id), 'application/pdf', PDF_HEAD, 10);

    const unconfirmed = await h.owner('owner-media-cleanup', 'POST', 'owner/media/cleanup', { json: { olderThanHours: 1 } });
    expect(unconfirmed.status).toBe(400);

    const res = await h.owner('owner-media-cleanup', 'POST', 'owner/media/cleanup', { json: { confirm: true, olderThanHours: 24 } });
    expect(res.status).toBe(200);
    expect((await body(res)).removed).toEqual({ pendingUploads: 1, rejected: 1, quarantined: 0 });
    const { rows } = await h.db.query('SELECT id FROM assets WHERE id = ANY($1::uuid[])', [[rej.asset.id, pend.asset.id, video.id]]);
    expect(rows.map((r: any) => r.id)).toEqual([video.id]);
    expect(h.blob.objects.has(await keyOf(video.id))).toBe(true);
  });

  it('reports storage usage and unused candidates to the owner', async () => {
    const p = await product('usage');
    await readyAsset(h, { kind: 'file', productId: p.id, mimeType: 'application/pdf', bytes: 300, head: PDF_HEAD });
    const usage = await body(await h.owner('owner-media-usage', 'GET', 'owner/media/usage'));
    expect(usage.quotaBytes).toBe(1_000_000);
    expect(usage.usedBytes).toBe(300);
    expect(usage.uploadLimits.file.mimeTypes).toContain('application/pdf');
    expect(usage.uploadLimits.file.mimeTypes).not.toContain('text/html');
  });
});

describe('protected downloads (M02)', () => {
  it('issues a five-minute single-blob link with a safe filename to an entitled buyer', async () => {
    const pub = await publishedDownload(h, 'guide-download');
    const { customerId } = await seedPurchase(h, { email: 'owned@example.test', productId: pub.productId });
    const link = await issueDownloadUrl(getDeps().db(), h.blob, customerId, pub.fileId);
    expect(link.url).toContain('sp=r');
    expect(link.url).toContain('se=300');
    expect(h.blob.readUrls.at(-1)!.name).toBe('PDF guide-v1.pdf'.replace(' ', '-'));
  });

  it('answers not_found for another customer, a revoked grant and a draft product', async () => {
    const pub = await publishedDownload(h, 'guarded-download');
    const owner = await seedPurchase(h, { email: 'one@example.test', productId: pub.productId });
    const other = await seedPurchase(h, { email: 'two@example.test', productId: pub.productId });
    await h.db.query(`UPDATE entitlements SET status = 'active' WHERE customer_id = $1`, [owner.customerId]);
    await expect(issueDownloadUrl(getDeps().db(), h.blob, other.customerId, pub.fileId)).resolves.toBeTruthy();

    const { customerId: stranger } = await seedPurchase(h, { email: 'stranger@example.test', productId: pub.productId, revoked: true });
    await expect(issueDownloadUrl(getDeps().db(), h.blob, stranger, pub.fileId)).rejects.toMatchObject({ status: 404 });
    await expect(issueDownloadUrl(getDeps().db(), h.blob, owner.customerId, 'b0000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });

    const draft = await product('draft-only');
    const draftFile = await readyAsset(h, { kind: 'file', productId: draft.id, mimeType: 'application/pdf', bytes: 100, head: PDF_HEAD });
    await h.db.query(`INSERT INTO entitlement_grants (id, customer_id, product_id, source, status) VALUES (gen_random_uuid(), $1, $2, 'complimentary', 'active')`, [owner.customerId, draft.id]);
    await h.db.query(`INSERT INTO entitlements (customer_id, product_id, status) VALUES ($1, $2, 'active')`, [owner.customerId, draft.id]);
    await expect(issueDownloadUrl(getDeps().db(), h.blob, owner.customerId, draftFile.id)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps a pinned product’s post-purchase files out of an older buyer’s reach', async () => {
    const pub = await publishedDownload(h, 'pinned-download');
    await h.db.query(`UPDATE products SET update_policy = 'pinned' WHERE id = $1`, [pub.productId]);
    const buyer = await seedPurchase(h, { email: 'pinned@example.test', productId: pub.productId, createdAt: '2020-01-01T00:00:00Z' });
    await expect(issueDownloadUrl(getDeps().db(), h.blob, buyer.customerId, pub.fileId)).rejects.toMatchObject({ status: 404 });
  });

  it('builds filenames from product fields only and strips path, quote and header injection', () => {
    expect(downloadFilename('../../etc"passwd\r\nSet-Cookie: x', 'v1', 'application/pdf')).toMatch(/^[A-Za-z0-9._-]+\.pdf$/);
    expect(downloadFilename('', '', 'application/zip')).toBe('download.zip');
  });
});

describe('protected video, captions and resume (M03)', () => {
  it('refreshes a playback link only while the entitlement is valid, and keeps the resume position', async () => {
    const p = await product('video-play', 'course');
    const sec = await body(await h.owner('owner-section-create', 'POST', `owner/products/${p.id}/sections`, { params: { id: p.id }, json: { title: 'S' } }));
    const video = await readyAsset(h, { kind: 'video', productId: p.id, mimeType: 'video/mp4', bytes: 5000, head: MP4_HEAD });
    const lessonRes = await body(await h.owner('owner-lesson-create', 'POST', `owner/sections/${sec.section.id}/lessons`, { params: { id: sec.section.id }, json: { title: 'V', kind: 'video', videoAssetId: video.id } }));
    await h.db.query(`UPDATE products SET status = 'published' WHERE id = $1`, [p.id]);
    const buyer = await seedPurchase(h, { email: 'watch@example.test', productId: p.id });
    const db = getDeps().db();

    await recordResumePosition(db, buyer.customerId, lessonRes.lesson.id, 421);
    const first = await issuePlaybackUrl(db, h.blob, buyer.customerId, lessonRes.lesson.id, 'video');
    expect(first.resumeSeconds).toBe(421);
    expect(h.blob.readUrls.at(-1)!.seconds).toBe(900);

    await h.db.query(`UPDATE entitlements SET status = 'revoked' WHERE customer_id = $1`, [buyer.customerId]);
    await expect(issuePlaybackUrl(db, h.blob, buyer.customerId, lessonRes.lesson.id, 'video')).rejects.toMatchObject({ status: 404 });
    await expect(recordResumePosition(db, buyer.customerId, lessonRes.lesson.id, 10)).rejects.toMatchObject({ status: 404 });
  });

  it('answers not_found for a missing caption track rather than a broken link', async () => {
    const p = await product('no-caption', 'course');
    const sec = await body(await h.owner('owner-section-create', 'POST', `owner/products/${p.id}/sections`, { params: { id: p.id }, json: { title: 'S' } }));
    const lessonRes = await body(await h.owner('owner-lesson-create', 'POST', `owner/sections/${sec.section.id}/lessons`, { params: { id: sec.section.id }, json: { title: 'V', kind: 'video' } }));
    await h.db.query(`UPDATE products SET status = 'published' WHERE id = $1`, [p.id]);
    const buyer = await seedPurchase(h, { email: 'nocap@example.test', productId: p.id });
    await expect(issuePlaybackUrl(getDeps().db(), h.blob, buyer.customerId, lessonRes.lesson.id, 'caption')).rejects.toMatchObject({ status: 404 });
  });
});
