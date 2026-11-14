import type { Db, Tx } from '../core/db.js';
import { withTransaction } from '../core/db.js';
import { apiErrors, type Issue } from '../core/errors.js';
import type { ShopUpdate } from '@pagelet/contracts';
import { audit } from './audit.js';
import { checkAccent } from './contrast.js';
import { conflict } from './catalog.js';

type Queryable = Db | Tx;

export interface ShopRow {
  shop_name: string;
  currency: string;
  timezone: string;
  accent_hex: string;
  creator_name: string;
  creator_bio: string;
  introduction: string;
  featured_product_id: string | null;
  seller_details: Record<string, string>;
  legal_pages: Record<string, string>;
  contact_links: Array<{ label: string; url: string }>;
  tax_mode: 'unset' | 'none' | 'stripe_tax_configured';
  digital_delivery_consent_version: number;
  legal_policy_version: number;
  logo_asset_id: string | null;
  logo_alt: string;
}

export interface LaunchMissing {
  code: string;
  message: string;
}

const EMPTY_SHOP: ShopRow = {
  shop_name: '', currency: '', timezone: 'UTC', accent_hex: '#244ACC', creator_name: '', creator_bio: '', introduction: '',
  featured_product_id: null, seller_details: {}, legal_pages: {}, contact_links: [], tax_mode: 'unset',
  digital_delivery_consent_version: 0, legal_policy_version: 0, logo_asset_id: null, logo_alt: '',
};
const REQUIRED_LEGAL = ['terms', 'privacy', 'refund'] as const;
const REQUIRED_SELLER = ['legalName', 'address', 'contactEmail'] as const;

/**
 * Items that block live checkout. Checkout consults this list; an empty list means launch-ready.
 * Reads the same shop_settings keys the checkout gate relies on.
 */
export async function launchMissing(q: Queryable, row: ShopRow | null = null): Promise<LaunchMissing[]> {
  const loaded = row ?? (await loadShop(q));
  const missing: LaunchMissing[] = [];
  if (!loaded) missing.push({ code: 'shop_not_configured', message: 'Set the shop currency and name.' });
  const shop: ShopRow = loaded ?? EMPTY_SHOP;
  for (const key of REQUIRED_SELLER) {
    if (!shop.seller_details[key]?.trim()) missing.push({ code: `seller_${key}`, message: `Add the seller ${key === 'contactEmail' ? 'contact email' : key === 'legalName' ? 'legal name' : 'address'}.` });
  }
  for (const key of REQUIRED_LEGAL) {
    if (!shop.legal_pages[key]?.trim()) missing.push({ code: `legal_${key}`, message: `Link the ${key === 'refund' ? 'refund policy' : key} page.` });
  }
  if (shop.digital_delivery_consent_version < 1) missing.push({ code: 'digital_delivery_consent', message: 'Accept the digital-delivery consent.' });
  if (shop.tax_mode === 'unset') missing.push({ code: 'tax_mode', message: 'Choose a tax mode: none, or Stripe Tax configured.' });
  if (!checkAccent(shop.accent_hex).ok) missing.push({ code: 'accent_contrast', message: 'The accent colour does not meet contrast requirements.' });
  const published = await q.query<{ n: string }>(`SELECT count(*) AS n FROM products WHERE status = 'published'`);
  if (Number(published.rows[0]!.n) === 0) missing.push({ code: 'no_published_product', message: 'Publish at least one product.' });
  return missing;
}

async function loadShop(q: Queryable): Promise<ShopRow | null> {
  const { rows } = await q.query<ShopRow>('SELECT * FROM shop_settings WHERE id = 1');
  return rows[0] ?? null;
}

export async function getShop(db: Db) {
  const row = await loadShop(db);
  const launchMissingItems = await launchMissing(db, row);
  return { settings: row ? shopView(row) : null, launchReady: { ready: launchMissingItems.length === 0, missing: launchMissingItems } };
}

function shopView(row: ShopRow) {
  return {
    shopName: row.shop_name,
    currency: row.currency,
    timezone: row.timezone,
    accentHex: row.accent_hex,
    creatorName: row.creator_name,
    creatorBio: row.creator_bio,
    introduction: row.introduction,
    featuredProductId: row.featured_product_id,
    contactLinks: row.contact_links,
    sellerDetails: row.seller_details,
    legalPages: row.legal_pages,
    taxMode: row.tax_mode,
    digitalDeliveryConsentVersion: row.digital_delivery_consent_version,
    legalPolicyVersion: row.legal_policy_version,
    logoAssetId: row.logo_asset_id,
    logoAlt: row.logo_alt,
  };
}

function validTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export async function updateShop(db: Db, input: ShopUpdate, actor = 'owner') {
  return withTransaction(db, async (tx) => {
    const issues: Issue[] = [];
    const current = await tx.query<ShopRow>('SELECT * FROM shop_settings WHERE id = 1 FOR UPDATE');
    const row = current.rows[0] ?? null;

    if (input.accentHex !== undefined) {
      const check = checkAccent(input.accentHex);
      if (!check.ok) {
        issues.push({
          path: 'accentHex',
          message: `The accent needs at least ${check.minimum}:1 contrast on white and on the Paper canvas (now ${check.ratioOnWhite}:1 and ${check.ratioOnPaper}:1).`,
        });
      }
    }
    if (input.timezone !== undefined && !validTimezone(input.timezone)) issues.push({ path: 'timezone', message: 'Choose a valid IANA timezone.' });
    if (input.currency !== undefined && row && input.currency !== row.currency) {
      const orders = await tx.query<{ n: string }>('SELECT count(*) AS n FROM orders');
      if (Number(orders.rows[0]!.n) > 0) throw conflict('The shop currency is locked after the first order.', [{ path: 'currency', message: 'Currency cannot change after a sale.' }]);
    }
    if (!row && input.currency === undefined) issues.push({ path: 'currency', message: 'Choose the shop currency first.' });
    if (input.featuredProductId) {
      const p = await tx.query<{ status: string }>('SELECT status FROM products WHERE id = $1', [input.featuredProductId]);
      if (!p.rows[0]) issues.push({ path: 'featuredProductId', message: 'Choose an existing product.' });
      else if (p.rows[0].status !== 'published') issues.push({ path: 'featuredProductId', message: 'Only a published product can be featured.' });
    }
    if (input.logoAssetId) {
      const a = await tx.query<{ kind: string; status: string }>('SELECT kind, status FROM assets WHERE id = $1', [input.logoAssetId]);
      if (!a.rows[0] || a.rows[0].kind !== 'logo') issues.push({ path: 'logoAssetId', message: 'Upload a logo image first.' });
      else if (a.rows[0].status !== 'ready') issues.push({ path: 'logoAssetId', message: 'The logo is not ready yet.' });
    }
    if (issues.length) throw apiErrors.validation(issues);

    const legalBefore = row?.legal_pages ?? {};
    const legalAfter = input.legalPages !== undefined ? { ...legalBefore, ...input.legalPages } : legalBefore;
    const legalChanged = input.legalPages !== undefined && JSON.stringify(legalBefore) !== JSON.stringify(legalAfter);
    const consentAccepted = input.digitalDeliveryConsentAccepted === true;

    const merged = {
      shop_name: input.shopName ?? row?.shop_name ?? 'My shop',
      currency: input.currency ?? row?.currency,
      timezone: input.timezone ?? row?.timezone ?? 'UTC',
      accent_hex: input.accentHex ?? row?.accent_hex ?? '#244ACC',
      creator_name: input.creatorName ?? row?.creator_name ?? '',
      creator_bio: input.creatorBio ?? row?.creator_bio ?? '',
      introduction: input.introduction ?? row?.introduction ?? '',
      featured_product_id: input.featuredProductId !== undefined ? input.featuredProductId : (row?.featured_product_id ?? null),
      seller_details: input.sellerDetails !== undefined ? { ...(row?.seller_details ?? {}), ...input.sellerDetails } : (row?.seller_details ?? {}),
      legal_pages: legalAfter,
      contact_links: JSON.stringify(input.contactLinks ?? row?.contact_links ?? []),
      tax_mode: input.taxMode ?? row?.tax_mode ?? 'unset',
      consent_version: consentAccepted ? Math.max(row?.digital_delivery_consent_version ?? 0, 1) : (row?.digital_delivery_consent_version ?? 0),
      legal_policy_version: legalChanged ? (row?.legal_policy_version ?? 0) + 1 : (row?.legal_policy_version ?? 0),
      logo_asset_id: input.logoAssetId !== undefined ? input.logoAssetId : (row?.logo_asset_id ?? null),
      logo_alt: input.logoAlt ?? row?.logo_alt ?? '',
    };

    if (!row) {
      await tx.query(
        `INSERT INTO shop_settings (id, shop_name, currency, timezone, accent_hex, creator_name, creator_bio, introduction,
                                    featured_product_id, seller_details, legal_pages, contact_links, tax_mode,
                                    digital_delivery_consent_version, legal_policy_version, logo_asset_id, logo_alt)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16)`,
        [merged.shop_name, merged.currency, merged.timezone, merged.accent_hex, merged.creator_name, merged.creator_bio, merged.introduction,
          merged.featured_product_id, JSON.stringify(merged.seller_details), JSON.stringify(merged.legal_pages), merged.contact_links,
          merged.tax_mode, merged.consent_version, merged.legal_policy_version, merged.logo_asset_id, merged.logo_alt],
      );
    } else {
      await tx.query(
        `UPDATE shop_settings SET shop_name = $1, currency = $2, timezone = $3, accent_hex = $4, creator_name = $5, creator_bio = $6,
                introduction = $7, featured_product_id = $8, seller_details = $9::jsonb, legal_pages = $10::jsonb,
                contact_links = $11::jsonb, tax_mode = $12, digital_delivery_consent_version = $13, legal_policy_version = $14,
                logo_asset_id = $15, logo_alt = $16, updated_at = now()
          WHERE id = 1`,
        [merged.shop_name, merged.currency, merged.timezone, merged.accent_hex, merged.creator_name, merged.creator_bio, merged.introduction,
          merged.featured_product_id, JSON.stringify(merged.seller_details), JSON.stringify(merged.legal_pages), merged.contact_links,
          merged.tax_mode, merged.consent_version, merged.legal_policy_version, merged.logo_asset_id, merged.logo_alt],
      );
    }
    await audit(tx, { actor, action: 'shop.update', subjectType: 'shop', subjectId: '1', details: { fields: Object.keys(input) } });
    return getShopInTx(tx);
  });
}

async function getShopInTx(tx: Tx) {
  const row = await loadShop(tx);
  const items = await launchMissing(tx, row);
  return { settings: row ? shopView(row) : null, launchReady: { ready: items.length === 0, missing: items } };
}
