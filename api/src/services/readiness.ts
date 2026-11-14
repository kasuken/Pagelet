import type { Db } from '../core/db.js';
import { apiErrors } from '../core/errors.js';

/**
 * Launch gate for live checkout (C05). Keys below are the contract with the branding editor:
 * seller_details.{legalName,address,contactEmail}, legal_pages.{terms,privacy,refund} (non-empty paths),
 * digital_delivery_consent_version >= 1, and tax_mode set to an explicit choice (never 'unset').
 */
export async function missingLaunchRequirements(db: Db): Promise<string[]> {
  const { rows } = await db.query<{
    seller_details: Record<string, unknown>;
    legal_pages: Record<string, unknown>;
    digital_delivery_consent_version: number;
    tax_mode: string;
    currency: string | null;
  }>(
    `SELECT seller_details, legal_pages, digital_delivery_consent_version, tax_mode, currency FROM shop_settings WHERE id = 1`,
  );
  const row = rows[0];
  if (!row) return ['shop settings'];
  const missing: string[] = [];
  const seller = row.seller_details ?? {};
  for (const key of ['legalName', 'address', 'contactEmail']) {
    if (typeof seller[key] !== 'string' || !(seller[key] as string).trim()) missing.push(`seller.${key}`);
  }
  const legal = row.legal_pages ?? {};
  for (const key of ['terms', 'privacy', 'refund']) {
    if (typeof legal[key] !== 'string' || !(legal[key] as string).trim()) missing.push(`legal.${key}`);
  }
  if (row.digital_delivery_consent_version < 1) missing.push('digitalDeliveryConsent');
  if (row.tax_mode === 'unset') missing.push('taxMode');
  return missing;
}

export async function assertLaunchReady(db: Db): Promise<void> {
  const missing = await missingLaunchRequirements(db);
  if (missing.length > 0) {
    throw apiErrors.conflict(`Checkout is not ready. Complete: ${missing.join(', ')}.`);
  }
}
