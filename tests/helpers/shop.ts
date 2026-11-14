import pg from 'pg';

/** Seeds a launch-ready shop with one published course (4900) and one free download. Returns stable IDs. */
export const IDS = {
  course: '00000000-0000-4000-8000-00000000c001',
  courseVersion: '00000000-0000-4000-8000-00000000c101',
  download: '00000000-0000-4000-8000-00000000d001',
  downloadVersion: '00000000-0000-4000-8000-00000000d101',
  draft: '00000000-0000-4000-8000-00000000e001',
  draftVersion: '00000000-0000-4000-8000-00000000e101',
};

export async function seedShop(db: pg.Pool, options: { ready?: boolean; versions?: boolean } = {}): Promise<void> {
  const ready = options.ready ?? true;
  const versions = options.versions ?? true;
  await db.query(
    `INSERT INTO shop_settings (id, shop_name, currency, timezone, seller_details, legal_pages, digital_delivery_consent_version, tax_mode)
     VALUES (1, 'Test Shop', 'EUR', 'Europe/Rome', $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET seller_details = EXCLUDED.seller_details, legal_pages = EXCLUDED.legal_pages,
       digital_delivery_consent_version = EXCLUDED.digital_delivery_consent_version, tax_mode = EXCLUDED.tax_mode`,
    [
      ready ? JSON.stringify({ legalName: 'Test Seller', address: 'Via Test 1', contactEmail: 'owner@shop.test' }) : '{}',
      ready ? JSON.stringify({ terms: '/terms', privacy: '/privacy', refund: '/refunds' }) : '{}',
      ready ? 1 : 0,
      ready ? 'none' : 'unset',
    ],
  );
  await seedProduct(db, { id: IDS.course, versionId: IDS.courseVersion, slug: 'course-one', type: 'course', price: 4900, title: 'Course One', versions });
  await seedProduct(db, { id: IDS.download, versionId: IDS.downloadVersion, slug: 'free-guide', type: 'download', price: 0, title: 'Free Guide', versions });
  await seedProduct(db, { id: IDS.draft, versionId: IDS.draftVersion, slug: 'draft-only', type: 'course', price: 900, title: 'Draft', status: 'draft', versions });
}

export async function seedProduct(
  db: pg.Pool,
  p: { id: string; versionId: string; slug: string; type: string; price: number; title: string; status?: string; versions?: boolean },
): Promise<void> {
  const status = p.status ?? 'published';
  const withVersion = p.versions ?? true;
  await db.query(
    `INSERT INTO products (id, slug, product_type, status, title, price_minor, published_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET price_minor = EXCLUDED.price_minor, title = EXCLUDED.title, status = EXCLUDED.status, published_version = EXCLUDED.published_version`,
    [p.id, p.slug, p.type, status, p.title, p.price, status === 'published' && withVersion ? 1 : null],
  );
  if (withVersion) {
    await db.query(
      `INSERT INTO product_versions (id, product_id, version_no, snapshot) VALUES ($1, $2, 1, $3)
       ON CONFLICT (id) DO NOTHING`,
      [p.versionId, p.id, JSON.stringify({ title: p.title, price: p.price })],
    );
  }
}
