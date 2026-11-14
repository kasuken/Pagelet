import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, body, seedShop, readyAsset, publishedDownload, seedPurchase, type Harness } from '../helpers/catalog.js';
import { PNG_HEAD } from '../helpers/blob.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness(54_414, 'catalog_shop');
}, 180_000);

afterAll(async () => {
  await h?.close();
});

beforeEach(async () => {
  await h.db.query('TRUNCATE shop_settings, products, product_versions, sections, lessons, lesson_resources, assets, customers, checkout_attempts, orders, order_items, entitlement_grants, entitlements, audit_events, publications RESTART IDENTITY CASCADE');
  h.blob.objects.clear();
});

const patchShop = (json: Record<string, unknown>) => h.owner('owner-shop-update', 'PATCH', 'owner/shop', { json });

const launchReady = async () => (await body(await h.owner('owner-shop-get', 'GET', 'owner/shop'))).launchReady;

describe('branding, creator and legal settings (C05)', () => {
  it('requires a currency on first save and returns a launch checklist before anything is configured', async () => {
    const missingCurrency = await patchShop({ shopName: 'x' });
    expect(missingCurrency.status).toBe(400);
    expect(JSON.parse(missingCurrency.body).error.issues[0].path).toBe('currency');
    const check = await launchReady();
    expect(check.ready).toBe(false);
    expect(check.missing.map((m: any) => m.code)).toEqual(expect.arrayContaining(['seller_legalName', 'legal_terms', 'digital_delivery_consent', 'tax_mode', 'no_published_product']));
  });

  it('rejects an inaccessible accent colour with the measured ratios and accepts the default cobalt', async () => {
    await seedShop(h);
    const yellow = await patchShop({ accentHex: '#FFFF00' });
    expect(yellow.status).toBe(400);
    const issue = JSON.parse(yellow.body).error.issues[0];
    expect(issue.path).toBe('accentHex');
    expect(issue.message).toMatch(/1\.\d+:1|\d:1/);
    const ok = await patchShop({ accentHex: '#244ACC' });
    expect(ok.status).toBe(200);
    expect((await body(ok)).settings.accentHex).toBe('#244ACC');
  });

  it('validates timezone and stores seller, contact and legal details in the keys checkout reads', async () => {
    await seedShop(h);
    expect((await patchShop({ timezone: 'Mars/Olympus' })).status).toBe(400);
    const res = await patchShop({
      timezone: 'Europe/Rome',
      sellerDetails: { legalName: 'Example Creator Ltd', address: '1 Example Street', contactEmail: 'owner@example.test' },
      legalPages: { terms: '/terms', privacy: '/privacy', refund: '/refunds' },
      contactLinks: [{ label: 'Mail', url: 'mailto:owner@example.test' }],
      taxMode: 'none',
    });
    expect(res.status).toBe(200);
    const { rows: [row] } = await h.db.query('SELECT seller_details, legal_pages, tax_mode, timezone FROM shop_settings WHERE id = 1');
    expect(row.seller_details).toMatchObject({ legalName: 'Example Creator Ltd', address: '1 Example Street', contactEmail: 'owner@example.test' });
    expect(row.legal_pages).toEqual({ terms: '/terms', privacy: '/privacy', refund: '/refunds' });
    expect(row.tax_mode).toBe('none');
    expect(row.timezone).toBe('Europe/Rome');
  });

  it('rejects unsafe contact links and legal paths', async () => {
    await seedShop(h);
    expect((await patchShop({ contactLinks: [{ label: 'x', url: 'javascript:alert(1)' }] })).status).toBe(400);
    expect((await patchShop({ legalPages: { terms: 'javascript:alert(1)' } })).status).toBe(400);
  });

  it('increments the legal policy version when legal pages change, and accepting consent sets it to at least 1', async () => {
    await seedShop(h);
    await patchShop({ legalPages: { terms: '/terms' } });
    const v1 = (await body(await h.owner('owner-shop-get', 'GET', 'owner/shop'))).settings.legalPolicyVersion;
    await patchShop({ legalPages: { terms: '/terms-v2' } });
    const v2 = (await body(await h.owner('owner-shop-get', 'GET', 'owner/shop'))).settings.legalPolicyVersion;
    expect(v2).toBe(v1 + 1);
    const consent = await patchShop({ digitalDeliveryConsentAccepted: true });
    expect((await body(consent)).settings.digitalDeliveryConsentVersion).toBe(1);
  });

  it('locks the currency after the first order, both in the API and in the database', async () => {
    await seedShop(h);
    const pub = await publishedDownload(h, 'currency-lock');
    expect((await patchShop({ currency: 'USD' })).status).toBe(200);
    await seedPurchase(h, { email: 'first@example.test', productId: pub.productId });
    const refused = await patchShop({ currency: 'GBP' });
    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body).error.issues[0].path).toBe('currency');
    await expect(h.db.query(`UPDATE shop_settings SET currency = 'JPY' WHERE id = 1`)).rejects.toThrow(/immutable/);
  });

  it('accepts a logo only as a ready logo asset and shows the launch checklist for the shop', async () => {
    await seedShop(h);
    const cover = await readyAsset(h, { kind: 'cover', productId: (await publishedDownload(h, 'logo-host')).productId, mimeType: 'image/png', bytes: 100, head: PNG_HEAD });
    expect((await patchShop({ logoAssetId: cover.id, logoAlt: 'Logo' })).status).toBe(400);
    const logo = await readyAsset(h, { kind: 'logo', mimeType: 'image/png', bytes: 100, head: PNG_HEAD });
    const ok = await patchShop({ logoAssetId: logo.id, logoAlt: 'Example Creator logo' });
    expect(ok.status).toBe(200);
    expect((await body(ok)).settings.logoAssetId).toBe(logo.id);
  });

  it('is launch-ready only once every required seller, legal, consent, tax and product item is in place', async () => {
    await seedShop(h);
    await publishedDownload(h, 'launch-product');
    await patchShop({
      sellerDetails: { legalName: 'Example Creator Ltd', address: '1 Example Street', contactEmail: 'owner@example.test' },
      legalPages: { terms: '/terms', privacy: '/privacy', refund: '/refunds' },
      digitalDeliveryConsentAccepted: true,
      taxMode: 'none',
    });
    expect(await launchReady()).toEqual({ ready: true, missing: [] });
  });

  it('refuses a featured product that is not published', async () => {
    await seedShop(h);
    const draft = (await body(await h.owner('owner-products-create', 'POST', 'owner/products', { json: { title: 'Draft', slug: 'draft-feature', productType: 'download', description: 'd', priceMinor: 0 } }))).product;
    const res = await patchShop({ featuredProductId: draft.id });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error.issues[0].path).toBe('featuredProductId');
  });
});
