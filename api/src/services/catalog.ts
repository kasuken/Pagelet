import { randomUUID } from 'node:crypto';
import type { Db, Tx } from '../core/db.js';
import { isUniqueViolation, withTransaction } from '../core/db.js';
import { ApiError, apiErrors, type Issue } from '../core/errors.js';
import type { BlobPort } from '../core/ports.js';
import { audit } from './audit.js';
import { sanitizeLessonHtml } from './sanitize.js';
import type { ProductCreate, ProductUpdate, LessonCreate, LessonUpdate } from '@pagelet/contracts';

type Queryable = Db | Tx;
export type ProductType = 'course' | 'download';
export type ProductStatus = 'draft' | 'published' | 'archived';

export const conflict = (message: string, issues?: Issue[]) => new ApiError(409, 'conflict', message, issues);
export const STALE_MESSAGE = 'This product changed since you opened it. Reload to review the latest version before saving.';
const SLUG_TAKEN: Issue = { path: 'slug', message: 'This slug is already used by another product.' };
const ARCHIVED_MESSAGE = 'Archived products are read-only.';

export interface ProductView {
  id: string;
  slug: string;
  productType: ProductType;
  status: ProductStatus;
  title: string;
  description: string;
  outcomes: string[];
  price: { amountMinor: number; currency: string };
  coverAssetId: string | null;
  coverAlt: string;
  updatePolicy: 'latest' | 'pinned';
  revision: number;
  publishedVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRow {
  id: string;
  slug: string;
  product_type: ProductType;
  status: ProductStatus;
  title: string;
  description: string;
  outcomes: string[];
  price_minor: number;
  cover_asset_id: string | null;
  cover_alt: string;
  update_policy: 'latest' | 'pinned';
  revision: number;
  published_version: number | null;
  created_at: Date;
  updated_at: Date;
}

/** Shop currency is required before any price can be shown or sold. */
export async function requireCurrency(q: Queryable): Promise<string> {
  const { rows } = await q.query<{ currency: string }>('SELECT currency FROM shop_settings WHERE id = 1');
  if (!rows[0]) throw conflict('Set the shop currency before adding products.', [{ path: 'currency', message: 'Choose the shop currency first.' }]);
  return rows[0].currency;
}

export function productView(row: ProductRow, currency: string): ProductView {
  return {
    id: row.id,
    slug: row.slug,
    productType: row.product_type,
    status: row.status,
    title: row.title,
    description: row.description,
    outcomes: row.outcomes,
    price: { amountMinor: row.price_minor, currency },
    coverAssetId: row.cover_asset_id,
    coverAlt: row.cover_alt,
    updatePolicy: row.update_policy,
    revision: row.revision,
    publishedVersion: row.published_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function lockProduct(tx: Tx, id: string): Promise<ProductRow> {
  const { rows } = await tx.query<ProductRow>('SELECT * FROM products WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw apiErrors.notFound('Product not found.');
  return rows[0];
}

function assertRevision(row: ProductRow, expected: number) {
  if (row.revision !== expected) throw conflict(STALE_MESSAGE);
}

/** Maps a unique violation on the slug to a field-level 409. Other errors pass through unchanged. */
function mapSlugConflict(error: unknown): never | void {
  if (isUniqueViolation(error) && (error as { constraint?: string }).constraint === 'products_slug_key') throw conflict('That slug is already in use.', [SLUG_TAKEN]);
  throw error;
}

export async function createProduct(db: Db, input: ProductCreate, actor = 'owner'): Promise<ProductView> {
  if (input.coverAssetId) {
    throw apiErrors.validation([{ path: 'coverAssetId', message: 'Upload a cover after the product is created, then attach it.' }]);
  }
  const id = randomUUID();
  try {
    return await withTransaction(db, async (tx) => {
      const currency = await requireCurrency(tx);
      const { rows } = await tx.query<ProductRow>(
        `INSERT INTO products (id, slug, product_type, title, description, outcomes, price_minor, cover_alt, update_policy)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [id, input.slug, input.productType, input.title, input.description, input.outcomes, input.priceMinor, input.coverAlt, input.updatePolicy],
      );
      await audit(tx, { actor, action: 'product.create', subjectType: 'product', subjectId: id, details: { slug: input.slug, productType: input.productType } });
      return productView(rows[0]!, currency);
    });
  } catch (error) {
    return mapSlugConflict(error) as never;
  }
}

export async function listProducts(db: Db, status?: ProductStatus): Promise<ProductView[]> {
  const currency = await requireCurrency(db).catch(() => null);
  const { rows } = await db.query<ProductRow>(
    `SELECT * FROM products WHERE ($1::text IS NULL OR status = $1) ORDER BY updated_at DESC, title LIMIT 200`,
    [status ?? null],
  );
  return rows.map((r) => productView(r, currency ?? ''));
}

export interface ProductDetail extends ProductView {
  sections: Array<{
    id: string;
    title: string;
    position: number;
    lessons: Array<{
      id: string;
      title: string;
      kind: 'video' | 'text';
      position: number;
      isPreview: boolean;
      bodyHtml: string;
      transcript: string;
      videoAssetId: string | null;
      captionAssetId: string | null;
      resourceAssetIds: string[];
    }>;
  }>;
  files: Array<{ id: string; versionLabel: string; status: string; mimeType: string; declaredBytes: number; actualBytes: number | null; replacesAssetId: string | null; createdAt: string; finalizedAt: string | null }>;
  publishReadiness: Issue[];
}

export async function getProduct(db: Db, id: string): Promise<ProductDetail> {
  const { rows } = await db.query<ProductRow>('SELECT * FROM products WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) throw apiErrors.notFound('Product not found.');
  const currency = await requireCurrency(db).catch(() => '');
  const sections = await db.query<{ id: string; title: string; position: number }>(
    'SELECT id, title, position FROM sections WHERE product_id = $1 ORDER BY position',
    [id],
  );
  const lessons = await db.query<{
    id: string; section_id: string; title: string; kind: 'video' | 'text'; position: number; is_preview: boolean;
    body_html: string; transcript: string; video_asset_id: string | null; caption_asset_id: string | null;
  }>(
    `SELECT id, section_id, title, kind, position, is_preview, body_html, transcript, video_asset_id, caption_asset_id
       FROM lessons WHERE product_id = $1 ORDER BY position`,
    [id],
  );
  const resources = await db.query<{ lesson_id: string; asset_id: string }>(
    'SELECT lesson_id, asset_id FROM lesson_resources WHERE product_id = $1 ORDER BY position',
    [id],
  );
  const files = await db.query<{
    id: string; version_label: string; status: string; mime_type: string; declared_bytes: string; actual_bytes: string | null;
    replaces_asset_id: string | null; created_at: Date; finalized_at: Date | null;
  }>(
    `SELECT id, version_label, status, mime_type, declared_bytes, actual_bytes, replaces_asset_id, created_at, finalized_at
       FROM assets WHERE product_id = $1 AND kind = 'file' AND status <> 'deleted' ORDER BY created_at`,
    [id],
  );
  const byLesson = new Map<string, string[]>();
  for (const r of resources.rows) byLesson.set(r.lesson_id, [...(byLesson.get(r.lesson_id) ?? []), r.asset_id]);
  return {
    ...productView(row, currency),
    sections: sections.rows.map((s) => ({
      id: s.id,
      title: s.title,
      position: s.position,
      lessons: lessons.rows
        .filter((l) => l.section_id === s.id)
        .map((l) => ({
          id: l.id,
          title: l.title,
          kind: l.kind,
          position: l.position,
          isPreview: l.is_preview,
          bodyHtml: l.body_html,
          transcript: l.transcript,
          videoAssetId: l.video_asset_id,
          captionAssetId: l.caption_asset_id,
          resourceAssetIds: byLesson.get(l.id) ?? [],
        })),
    })),
    files: files.rows.map((f) => ({
      id: f.id,
      versionLabel: f.version_label,
      status: f.status,
      mimeType: f.mime_type,
      declaredBytes: Number(f.declared_bytes),
      actualBytes: f.actual_bytes === null ? null : Number(f.actual_bytes),
      replacesAssetId: f.replaces_asset_id,
      createdAt: f.created_at.toISOString(),
      finalizedAt: f.finalized_at?.toISOString() ?? null,
    })),
    publishReadiness: await editorReadiness(db, id),
  };
}

export async function updateProduct(db: Db, id: string, input: ProductUpdate, actor = 'owner'): Promise<ProductView> {
  try {
    return await withTransaction(db, async (tx) => {
      const row = await lockProduct(tx, id);
      assertRevision(row, input.revision);
      if (row.status === 'archived') throw conflict(ARCHIVED_MESSAGE);
      const currency = await requireCurrency(tx);

      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (input.title !== undefined) set('title', input.title);
      if (input.slug !== undefined) set('slug', input.slug);
      if (input.description !== undefined) set('description', input.description);
      if (input.outcomes !== undefined) set('outcomes', input.outcomes);
      if (input.priceMinor !== undefined) set('price_minor', input.priceMinor);
      if (input.coverAlt !== undefined) set('cover_alt', input.coverAlt);
      if (input.updatePolicy !== undefined) set('update_policy', input.updatePolicy);

      if (input.productType !== undefined && input.productType !== row.product_type) {
        if (row.status !== 'draft') throw conflict('Only a draft product can change type.');
        const { rows } = await tx.query<{ n: string }>(
          `SELECT (SELECT count(*) FROM sections WHERE product_id = $1) + (SELECT count(*) FROM assets WHERE product_id = $1) AS n`,
          [id],
        );
        if (Number(rows[0]!.n) > 0) throw conflict('Remove the curriculum and files before changing the product type.');
        set('product_type', input.productType);
      }
      if (input.coverAssetId !== undefined) {
        if (input.coverAssetId !== null) {
          const { rows } = await tx.query<{ kind: string }>('SELECT kind FROM assets WHERE id = $1 AND product_id = $2', [input.coverAssetId, id]);
          if (!rows[0]) throw apiErrors.validation([{ path: 'coverAssetId', message: 'Choose a cover uploaded for this product.' }]);
          if (rows[0].kind !== 'cover') throw apiErrors.validation([{ path: 'coverAssetId', message: 'That file is not a cover image.' }]);
        }
        set('cover_asset_id', input.coverAssetId);
      }
      if (sets.length === 0) return productView(row, currency);

      params.push(id);
      const { rows } = await tx.query<ProductRow>(
        `UPDATE products SET ${sets.join(', ')}, revision = revision + 1, updated_at = now() WHERE id = $${params.length} RETURNING *`,
        params,
      );
      await audit(tx, { actor, action: 'product.update', subjectType: 'product', subjectId: id, details: { fields: Object.keys(input).filter((k) => k !== 'revision') } });
      return productView(rows[0]!, currency);
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as { code?: string }).code === '23503' && (error as { constraint?: string }).constraint === 'products_cover_same_product_fk') {
      throw apiErrors.validation([{ path: 'coverAssetId', message: 'Choose a cover uploaded for this product.' }]);
    }
    return mapSlugConflict(error) as never;
  }
}

/** Owner-facing checklist. The publish gate itself is publication.ts requestPublication(); keep the two in step. */
/** Every reason a product cannot go public. Empty means publishable. Lesson-level items are path-addressed. */
export async function editorReadiness(q: Queryable, productId: string): Promise<Issue[]> {
  const issues: Issue[] = [];
  const { rows } = await q.query<ProductRow>('SELECT * FROM products WHERE id = $1', [productId]);
  const product = rows[0];
  if (!product) return [{ path: 'product', message: 'Product not found.' }];
  if (!product.description.trim()) issues.push({ path: 'description', message: 'Add a description.' });
  if (!product.cover_asset_id) {
    issues.push({ path: 'coverAssetId', message: 'Add a cover image.' });
  } else {
    const cover = await q.query<{ status: string }>('SELECT status FROM assets WHERE id = $1', [product.cover_asset_id]);
    if (cover.rows[0]?.status !== 'ready') issues.push({ path: 'coverAssetId', message: 'The cover image is not ready yet.' });
  }

  if (product.product_type === 'course') {
    const lessons = await q.query<{
      id: string; title: string; kind: string; body_html: string; transcript: string; video_status: string | null; caption_status: string | null;
    }>(
      `SELECT l.id, l.title, l.kind, l.body_html, l.transcript,
              v.status AS video_status, c.status AS caption_status
         FROM lessons l
         JOIN sections s ON s.id = l.section_id
         LEFT JOIN assets v ON v.id = l.video_asset_id
         LEFT JOIN assets c ON c.id = l.caption_asset_id
        WHERE l.product_id = $1
        ORDER BY s.position, l.position`,
      [productId],
    );
    if (lessons.rows.length === 0) issues.push({ path: 'sections', message: 'Add at least one lesson.' });
    for (const l of lessons.rows) {
      const where = `Lesson “${l.title}”`;
      if (l.kind === 'text') {
        if (!l.body_html.trim()) issues.push({ path: `lessons.${l.id}.bodyHtml`, message: `${where} has no text yet.` });
      } else {
        if (!l.video_status) issues.push({ path: `lessons.${l.id}.videoAssetId`, message: `${where} needs a video.` });
        else if (l.video_status !== 'ready') issues.push({ path: `lessons.${l.id}.videoAssetId`, message: `${where}: the video is ${l.video_status === 'rejected' ? 'rejected' : 'not ready yet'}.` });
        if (!l.caption_status) issues.push({ path: `lessons.${l.id}.captionAssetId`, message: `${where} needs WebVTT captions.` });
        else if (l.caption_status !== 'ready') issues.push({ path: `lessons.${l.id}.captionAssetId`, message: `${where}: the captions are ${l.caption_status === 'rejected' ? 'rejected' : 'not ready yet'}.` });
        if (!l.transcript.trim()) issues.push({ path: `lessons.${l.id}.transcript`, message: `${where} needs a transcript.` });
      }
    }
    const badResources = await q.query<{ id: string; lesson_id: string; status: string }>(
      `SELECT a.id, r.lesson_id, a.status FROM lesson_resources r JOIN assets a ON a.id = r.asset_id
        WHERE r.product_id = $1 AND a.status <> 'ready'`,
      [productId],
    );
    for (const r of badResources.rows) issues.push({ path: `lessons.${r.lesson_id}.resourceAssetIds`, message: `A lesson resource is ${r.status === 'rejected' ? 'rejected' : 'not ready yet'}.` });
  } else {
    const files = await q.query<{ id: string; status: string; version_label: string }>(
      `SELECT id, status, version_label FROM assets WHERE product_id = $1 AND kind = 'file' AND status <> 'deleted' ORDER BY created_at`,
      [productId],
    );
    if (!files.rows.some((f) => f.status === 'ready')) issues.push({ path: 'files', message: 'Add at least one file.' });
    for (const f of files.rows) {
      if (f.status === 'rejected') issues.push({ path: `files.${f.id}`, message: `File ${f.version_label} was rejected. Replace it or remove it.` });
      else if (f.status !== 'ready') issues.push({ path: `files.${f.id}`, message: `File ${f.version_label} is still ${f.status === 'pending_upload' ? 'uploading' : 'being checked'}.` });
    }
  }
  return issues;
}

/** Deletion is only for never-sold drafts. Anything with an order, grant, checkout or version is archived instead. */
export async function deleteProduct(db: Db, id: string, revision: number, blobFor: () => BlobPort, actor = 'owner'): Promise<void> {
  const keys = await withTransaction(db, async (tx) => {
    const row = await lockProduct(tx, id);
    assertRevision(row, revision);
    if (row.status !== 'draft') throw conflict('Published or archived products cannot be deleted. Archive the product instead.');
    const refs = await tx.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM order_items WHERE product_id = $1)
            + (SELECT count(*) FROM entitlement_grants WHERE product_id = $1)
            + (SELECT count(*) FROM entitlements WHERE product_id = $1)
            + (SELECT count(*) FROM checkout_attempts WHERE product_id = $1)
            + (SELECT count(*) FROM product_versions WHERE product_id = $1)
            + (SELECT count(*) FROM shop_settings WHERE featured_product_id = $1) AS n`,
      [id],
    );
    if (Number(refs.rows[0]!.n) > 0) throw conflict('This product has been sold or referenced. Archive it instead of deleting it.');
    const assets = await tx.query<{ object_key: string }>('SELECT object_key FROM assets WHERE product_id = $1', [id]);
    await tx.query('UPDATE products SET cover_asset_id = NULL WHERE id = $1', [id]);
    await tx.query('DELETE FROM lesson_resources WHERE product_id = $1', [id]);
    await tx.query('DELETE FROM lessons WHERE product_id = $1', [id]);
    await tx.query('DELETE FROM sections WHERE product_id = $1', [id]);
    await tx.query('UPDATE assets SET replaces_asset_id = NULL WHERE product_id = $1', [id]);
    await tx.query('DELETE FROM assets WHERE product_id = $1', [id]);
    await tx.query('DELETE FROM products WHERE id = $1', [id]);
    await audit(tx, { actor, action: 'product.delete', subjectType: 'product', subjectId: id, details: { slug: row.slug } });
    return assets.rows.map((a) => a.object_key);
  });
  // Blob removal happens after commit and is best-effort: a failure leaves an orphan that cleanup removes later.
  await removeBlobs(blobFor, keys);
}

export async function removeBlobs(blobFor: () => BlobPort, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const blob = blobFor();
  for (const key of keys) await blob.delete(key).catch(() => undefined);
}

// ---- Curriculum --------------------------------------------------------------

/** Archived products are read-only. Returns the product id for a section, locking the product row. */
async function lockSectionProduct(tx: Tx, sectionId: string): Promise<string> {
  const { rows } = await tx.query<{ product_id: string }>('SELECT product_id FROM sections WHERE id = $1', [sectionId]);
  if (!rows[0]) throw apiErrors.notFound('Section not found.');
  const product = await lockProduct(tx, rows[0].product_id);
  if (product.status === 'archived') throw conflict(ARCHIVED_MESSAGE);
  return product.id;
}

export async function createSection(db: Db, productId: string, title: string, actor = 'owner') {
  return withTransaction(db, async (tx) => {
    const product = await lockProduct(tx, productId);
    if (product.status === 'archived') throw conflict(ARCHIVED_MESSAGE);
    if (product.product_type !== 'course') throw conflict('Sections belong to course products.');
    const { rows } = await tx.query<{ id: string; position: number; title: string }>(
      `INSERT INTO sections (id, product_id, position, title)
       VALUES ($1, $2, (SELECT COALESCE(MAX(position), -1) + 1 FROM sections WHERE product_id = $2), $3)
       RETURNING id, title, position`,
      [randomUUID(), productId, title],
    );
    await audit(tx, { actor, action: 'section.create', subjectType: 'section', subjectId: rows[0]!.id, details: { productId } });
    return rows[0]!;
  });
}

export async function updateSection(db: Db, sectionId: string, title: string | undefined, actor = 'owner') {
  return withTransaction(db, async (tx) => {
    await lockSectionProduct(tx, sectionId);
    if (title === undefined) {
      const { rows } = await tx.query('SELECT id, title, position FROM sections WHERE id = $1', [sectionId]);
      return rows[0];
    }
    const { rows } = await tx.query('UPDATE sections SET title = $2 WHERE id = $1 RETURNING id, title, position', [sectionId, title]);
    await audit(tx, { actor, action: 'section.update', subjectType: 'section', subjectId: sectionId, details: {} });
    return rows[0];
  });
}

export async function deleteSection(db: Db, sectionId: string, actor = 'owner'): Promise<void> {
  await withTransaction(db, async (tx) => {
    await lockSectionProduct(tx, sectionId);
    const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM lessons WHERE section_id = $1', [sectionId]);
    if (Number(rows[0]!.n) > 0) throw conflict('Remove or move the lessons in this section first.');
    await tx.query('DELETE FROM sections WHERE id = $1', [sectionId]);
    await audit(tx, { actor, action: 'section.delete', subjectType: 'section', subjectId: sectionId, details: {} });
  });
}

/** Full ordered id list for the product's sections. Stale lists are refused rather than partially applied. */
export async function reorderSections(db: Db, productId: string, ids: string[], actor = 'owner'): Promise<void> {
  await withTransaction(db, async (tx) => {
    const product = await lockProduct(tx, productId);
    if (product.status === 'archived') throw conflict(ARCHIVED_MESSAGE);
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM sections WHERE product_id = $1', [productId]);
    assertSameSet(rows.map((r) => r.id), ids);
    await tx.query(
      `UPDATE sections s SET position = v.pos FROM (SELECT unnest($2::uuid[]) AS id, generate_series(0, $3::int - 1) AS pos) v
        WHERE s.id = v.id AND s.product_id = $1`,
      [productId, ids, ids.length],
    );
    await audit(tx, { actor, action: 'section.reorder', subjectType: 'product', subjectId: productId, details: { count: ids.length } });
  });
}

function assertSameSet(current: string[], proposed: string[]) {
  const a = [...current].sort();
  const b = [...proposed].sort();
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    throw conflict('The curriculum changed since you loaded it. Reload and try the move again.');
  }
}

export async function reorderLessons(db: Db, sectionId: string, ids: string[], actor = 'owner'): Promise<void> {
  await withTransaction(db, async (tx) => {
    await lockSectionProduct(tx, sectionId);
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM lessons WHERE section_id = $1', [sectionId]);
    assertSameSet(rows.map((r) => r.id), ids);
    await tx.query(
      `UPDATE lessons l SET position = v.pos FROM (SELECT unnest($2::uuid[]) AS id, generate_series(0, $3::int - 1) AS pos) v
        WHERE l.id = v.id AND l.section_id = $1`,
      [sectionId, ids, ids.length],
    );
    await audit(tx, { actor, action: 'lesson.reorder', subjectType: 'section', subjectId: sectionId, details: { count: ids.length } });
  });
}

interface LessonState {
  title: string;
  kind: 'video' | 'text';
  bodyHtml: string;
  transcript: string;
  isPreview: boolean;
  videoAssetId: string | null;
  captionAssetId: string | null;
  resourceAssetIds: string[];
}

/** Checks every asset reference belongs to this product and has the right kind. Cross-product refs fail here with a 400. */
async function checkLessonAssets(tx: Tx, productId: string, state: LessonState): Promise<void> {
  const issues: Issue[] = [];
  if (state.kind === 'text' && (state.videoAssetId || state.captionAssetId)) {
    issues.push({ path: 'kind', message: 'Text lessons cannot have a video or captions. Remove them first.' });
  }
  const wanted: Array<{ id: string | null; kind: string; path: string }> = [
    { id: state.videoAssetId, kind: 'video', path: 'videoAssetId' },
    { id: state.captionAssetId, kind: 'caption', path: 'captionAssetId' },
    ...state.resourceAssetIds.map((id) => ({ id, kind: 'file', path: 'resourceAssetIds' })),
  ];
  const ids = wanted.map((w) => w.id).filter((v): v is string => Boolean(v));
  const found = ids.length
    ? await tx.query<{ id: string; kind: string; product_id: string | null }>('SELECT id, kind, product_id FROM assets WHERE id = ANY($1::uuid[])', [ids])
    : { rows: [] as Array<{ id: string; kind: string; product_id: string | null }> };
  const byId = new Map(found.rows.map((r) => [r.id, r]));
  for (const w of wanted) {
    if (!w.id) continue;
    const a = byId.get(w.id);
    if (!a || a.product_id !== productId) issues.push({ path: w.path, message: 'That file does not belong to this product.' });
    else if (a.kind !== w.kind) issues.push({ path: w.path, message: `That file is not a ${w.kind === 'file' ? 'downloadable file' : w.kind}.` });
  }
  if (issues.length) throw apiErrors.validation(issues);
}

function mapLessonFkConflict(error: unknown): never {
  if ((error as { code?: string }).code === '23503') {
    const constraint = (error as { constraint?: string }).constraint ?? '';
    const path = constraint === 'lessons_video_asset_fk' ? 'videoAssetId' : constraint === 'lessons_caption_asset_fk' ? 'captionAssetId' : 'resourceAssetIds';
    throw apiErrors.validation([{ path, message: 'That file does not belong to this product.' }]);
  }
  throw error;
}

async function writeResources(tx: Tx, lessonId: string, productId: string, ids: string[]) {
  await tx.query('DELETE FROM lesson_resources WHERE lesson_id = $1', [lessonId]);
  for (const [position, assetId] of ids.entries()) {
    await tx.query('INSERT INTO lesson_resources (lesson_id, product_id, asset_id, position) VALUES ($1, $2, $3, $4)', [lessonId, productId, assetId, position]);
  }
}

export async function createLesson(db: Db, sectionId: string, input: LessonCreate, actor = 'owner') {
  const id = randomUUID();
  try {
    return await withTransaction(db, async (tx) => {
      const productId = await lockSectionProduct(tx, sectionId);
      const state: LessonState = {
        title: input.title,
        kind: input.kind,
        bodyHtml: sanitizeLessonHtml(input.bodyHtml),
        transcript: input.transcript,
        isPreview: input.isPreview,
        videoAssetId: input.videoAssetId ?? null,
        captionAssetId: input.captionAssetId ?? null,
        resourceAssetIds: input.resourceAssetIds,
      };
      await checkLessonAssets(tx, productId, state);
      await tx.query(
        `INSERT INTO lessons (id, section_id, product_id, position, kind, title, body_html, video_asset_id, caption_asset_id, transcript, is_preview)
         VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM lessons WHERE section_id = $2), $4, $5, $6, $7, $8, $9, $10)`,
        [id, sectionId, productId, state.kind, state.title, state.bodyHtml, state.videoAssetId, state.captionAssetId, state.transcript, state.isPreview],
      );
      await writeResources(tx, id, productId, state.resourceAssetIds);
      await audit(tx, { actor, action: 'lesson.create', subjectType: 'lesson', subjectId: id, details: { kind: state.kind } });
      return { id };
    });
  } catch (error) {
    return mapLessonFkConflict(error);
  }
}

export async function updateLesson(db: Db, lessonId: string, patch: LessonUpdate, actor = 'owner') {
  try {
    return await withTransaction(db, async (tx) => {
      const { rows } = await tx.query<{
        section_id: string; product_id: string; title: string; kind: 'video' | 'text'; body_html: string; transcript: string;
        is_preview: boolean; video_asset_id: string | null; caption_asset_id: string | null;
      }>('SELECT * FROM lessons WHERE id = $1 FOR UPDATE', [lessonId]);
      const current = rows[0];
      if (!current) throw apiErrors.notFound('Lesson not found.');
      const productId = await lockSectionProduct(tx, current.section_id);
      const currentResources = await tx.query<{ asset_id: string }>('SELECT asset_id FROM lesson_resources WHERE lesson_id = $1 ORDER BY position', [lessonId]);
      const state: LessonState = {
        title: patch.title ?? current.title,
        kind: patch.kind ?? current.kind,
        bodyHtml: patch.bodyHtml !== undefined ? sanitizeLessonHtml(patch.bodyHtml) : current.body_html,
        transcript: patch.transcript ?? current.transcript,
        isPreview: patch.isPreview ?? current.is_preview,
        videoAssetId: patch.videoAssetId !== undefined ? patch.videoAssetId : current.video_asset_id,
        captionAssetId: patch.captionAssetId !== undefined ? patch.captionAssetId : current.caption_asset_id,
        resourceAssetIds: patch.resourceAssetIds ?? currentResources.rows.map((r) => r.asset_id),
      };
      await checkLessonAssets(tx, productId, state);
      await tx.query(
        `UPDATE lessons SET title = $2, kind = $3, body_html = $4, transcript = $5, is_preview = $6,
                video_asset_id = $7, caption_asset_id = $8 WHERE id = $1`,
        [lessonId, state.title, state.kind, state.bodyHtml, state.transcript, state.isPreview, state.videoAssetId, state.captionAssetId],
      );
      if (patch.resourceAssetIds !== undefined) await writeResources(tx, lessonId, productId, state.resourceAssetIds);
      await audit(tx, { actor, action: 'lesson.update', subjectType: 'lesson', subjectId: lessonId, details: { fields: Object.keys(patch) } });
      return { id: lessonId };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return mapLessonFkConflict(error);
  }
}

export async function deleteLesson(db: Db, lessonId: string, actor = 'owner'): Promise<void> {
  await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ section_id: string }>('SELECT section_id FROM lessons WHERE id = $1 FOR UPDATE', [lessonId]);
    if (!rows[0]) throw apiErrors.notFound('Lesson not found.');
    await lockSectionProduct(tx, rows[0].section_id);
    const progress = await tx.query<{ n: string }>('SELECT count(*) AS n FROM lesson_progress WHERE lesson_id = $1', [lessonId]);
    if (Number(progress.rows[0]!.n) > 0) throw conflict('Learners have progress in this lesson. Archive the product instead of removing lessons.');
    await tx.query('DELETE FROM lesson_resources WHERE lesson_id = $1', [lessonId]);
    await tx.query('DELETE FROM lessons WHERE id = $1', [lessonId]);
    await audit(tx, { actor, action: 'lesson.delete', subjectType: 'lesson', subjectId: lessonId, details: {} });
  });
}
