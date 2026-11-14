import type { Db } from '../core/db.js';
import { apiErrors } from '../core/errors.js';

export interface PublicLesson {
  title: string;
  kind: 'video' | 'text';
  preview: boolean;
  /** Only previews carry lesson body text; everything else is outline only. */
  bodyHtml?: string;
}

export interface PublicProduct {
  slug: string;
  productType: 'course' | 'download';
  title: string;
  description: string;
  outcomes: string[];
  price: { amountMinor: number; currency: string };
  sections: Array<{ title: string; lessons: PublicLesson[] }>;
}

/** Public catalog: only products whose published version is live. Drafts, private lessons and asset keys never appear. */
export async function publicCatalog(db: Db): Promise<PublicProduct[]> {
  const { rows } = await db.query(
    `SELECT p.slug, pv.snapshot, s.currency FROM products p
       JOIN product_versions pv ON pv.product_id = p.id AND pv.version_no = p.published_version
       CROSS JOIN shop_settings s
      WHERE p.status = 'published' AND s.id = 1
      ORDER BY p.title`,
  );
  return rows.map((r) => toPublic(r.slug, r.snapshot, r.currency));
}

export async function publicProduct(db: Db, slug: string): Promise<PublicProduct> {
  const { rows } = await db.query(
    `SELECT p.slug, pv.snapshot, s.currency FROM products p
       JOIN product_versions pv ON pv.product_id = p.id AND pv.version_no = p.published_version
       CROSS JOIN shop_settings s
      WHERE p.slug = $1 AND p.status = 'published' AND s.id = 1`,
    [slug],
  );
  if (!rows[0]) throw apiErrors.notFound();
  return toPublic(rows[0].slug, rows[0].snapshot, rows[0].currency);
}

function toPublic(slug: string, snapshot: any, currency: string): PublicProduct {
  return {
    slug,
    productType: snapshot.productType,
    title: snapshot.title,
    description: snapshot.description,
    outcomes: snapshot.outcomes ?? [],
    price: { amountMinor: snapshot.priceMinor, currency },
    sections: (snapshot.sections ?? []).map((s: any) => ({
      title: s.title,
      lessons: (s.lessons ?? []).map((l: any) => ({ title: l.title, kind: l.kind, preview: Boolean(l.isPreview) })),
    })),
  };
}

/**
 * Public catalog as it will look after THIS publication succeeds: the publication's product is shown at its pending
 * version (or omitted for archive), every other product at its live version. Used only by the build workflow.
 */
export async function catalogForPublication(db: Db, publicationId: string): Promise<{ alreadySucceeded: boolean; items: PublicProduct[]; shop: unknown }> {
  const { rows: pubs } = await db.query<{ product_id: string; version_no: number; reason: string; status: string }>(
    'SELECT product_id, version_no, reason, status FROM publications WHERE id = $1',
    [publicationId],
  );
  const pub = pubs[0];
  if (!pub) throw apiErrors.notFound();
  const { rows } = await db.query(
    `SELECT p.id, p.slug, p.status, pv.snapshot, s.currency
       FROM products p
       JOIN product_versions pv ON pv.product_id = p.id
            AND pv.version_no = CASE WHEN p.id = $2 THEN $3 ELSE p.published_version END
       CROSS JOIN shop_settings s
      WHERE s.id = 1 AND (p.id <> $2 OR $4 <> 'archive')
        AND (p.id = $2 OR (p.status = 'published' AND p.published_version IS NOT NULL))`,
    [publicationId, pub.product_id, pub.version_no, pub.reason],
  );
  const items = rows.map((r) => toPublic(r.slug, r.snapshot, r.currency));
  return { alreadySucceeded: pub.status === 'succeeded', items, shop: await shopProfile(db) };
}

async function shopProfile(db: Db) {
  const { rows } = await db.query(
    `SELECT shop_name, creator_name, creator_bio, introduction, accent_hex, currency, contact_links, legal_pages, tax_mode FROM shop_settings WHERE id = 1`,
  );
  const s = rows[0];
  return s
    ? { shopName: s.shop_name, creator: { name: s.creator_name, bio: s.creator_bio }, introduction: s.introduction, accentHex: s.accent_hex, currency: s.currency, contactLinks: s.contact_links ?? [], legal: { terms: s.legal_pages?.terms ?? null, privacy: s.legal_pages?.privacy ?? null, refund: s.legal_pages?.refund ?? null }, taxMode: s.tax_mode }
    : null;
}
