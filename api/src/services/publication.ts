import { randomUUID } from 'node:crypto';
import { withTransaction, type Db, type Tx } from '../core/db.js';
import { apiErrors, type Issue } from '../core/errors.js';
import type { Deps } from '../core/deps.js';
import type { Logger } from '../core/logger.js';
import { audit } from './audit.js';
import { editorReadiness } from './catalog.js';

const TRIGGER_TIMEOUT_MS = 10_000;

/** Items that block publishing. Each names the field or media that is missing, so the owner can fix it. */
export async function publishReadiness(tx: Tx | Db, productId: string): Promise<Issue[]> {
  const { rows } = await tx.query<{
    title: string;
    description: string;
    outcomes: string[];
    product_type: string;
    price_minor: number;
  }>('SELECT title, description, outcomes, product_type, price_minor FROM products WHERE id = $1', [productId]);
  const p = rows[0];
  if (!p) throw apiErrors.notFound('Product not found.');
  // The catalog editor's checklist (cover, captions, transcripts, resource readiness) is the single source of truth.
  const issues: Issue[] = await editorReadiness(tx, productId);
  const add = (issue: Issue) => {
    if (!issues.some((i) => i.path === issue.path && i.message === issue.message)) issues.push(issue);
  };
  if (!p.title.trim()) add({ path: 'title', message: 'Add a title.' });
  if (p.outcomes.filter((o) => o.trim()).length === 0) add({ path: 'outcomes', message: 'Add at least one outcome.' });
  if (p.price_minor < 0) add({ path: 'price', message: 'The price cannot be negative.' });
  if (p.product_type === 'course') {
    const { rows: lessons } = await tx.query<{ lesson_count: number; missing_video: number; unready_video: number }>(
      `SELECT count(l.id)::int AS lesson_count,
              count(*) FILTER (WHERE l.kind = 'video' AND l.video_asset_id IS NULL)::int AS missing_video,
              count(*) FILTER (WHERE l.kind = 'video' AND l.video_asset_id IS NOT NULL
                               AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id = l.video_asset_id AND a.status = 'ready'))::int AS unready_video
         FROM lessons l WHERE l.product_id = $1`,
      [productId],
    );
    const l = lessons[0];
    if (l.lesson_count === 0) add({ path: 'curriculum', message: 'Add at least one lesson.' });
    if (l.missing_video > 0) add({ path: 'curriculum', message: `${l.missing_video} video lesson(s) have no video.` });
    if (l.unready_video > 0) add({ path: 'curriculum', message: `${l.unready_video} video(s) are not validated yet.` });
  } else {
    const { rows: files } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM assets WHERE product_id = $1 AND kind = 'file' AND status = 'ready'`,
      [productId],
    );
    if (files[0].n === 0) add({ path: 'files', message: 'Add at least one validated file.' });
  }
  return issues;
}

/**
 * Creates an immutable version snapshot and a queued publication. Saving never reaches this path, so drafts are never
 * public. The public pointer moves only when the build reports success (see recordResult).
 */
export async function requestPublication(
  deps: Deps,
  log: Logger,
  input: { productId: string; reason: 'publish' | 'archive'; actor: string },
): Promise<{ publicationId: string; versionNo: number; status: string }> {
  const db = deps.db();
  const created = await withTransaction(db, async (tx) => {
    await tx.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [input.productId]);
    if (input.reason === 'publish') {
      const issues = await publishReadiness(tx, input.productId);
      if (issues.length) throw apiErrors.validation(issues);
    }
    const { rows: versions } = await tx.query<{ next: number }>(
      'SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM product_versions WHERE product_id = $1',
      [input.productId],
    );
    const versionNo = input.reason === 'publish' ? versions[0].next : (await tx.query<{ v: number | null }>('SELECT published_version AS v FROM products WHERE id = $1', [input.productId])).rows[0].v ?? 1;
    if (input.reason === 'publish') {
      await tx.query(
        `INSERT INTO product_versions (id, product_id, version_no, snapshot)
         VALUES ($1, $2, $3, (SELECT jsonb_build_object(
             'title', p.title, 'slug', p.slug, 'description', p.description, 'outcomes', p.outcomes,
             'productType', p.product_type, 'priceMinor', p.price_minor,
             'sections', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', s.title, 'lessons',
                 COALESCE((SELECT jsonb_agg(jsonb_build_object('title', l.title, 'kind', l.kind, 'isPreview', l.is_preview) ORDER BY l.position)
                           FROM lessons l WHERE l.section_id = s.id), '[]'::jsonb)) ORDER BY s.position)
                 FROM sections s WHERE s.product_id = p.id), '[]'::jsonb)) FROM products p WHERE p.id = $2))`,
        [randomUUID(), input.productId, versionNo],
      );
      await tx.query('UPDATE products SET revision = revision + 1, updated_at = now() WHERE id = $1', [input.productId]);
    }
    const publicationId = randomUUID();
    await tx.query(
      `INSERT INTO publications (id, product_id, version_no, reason) VALUES ($1, $2, $3, $4)`,
      [publicationId, input.productId, versionNo, input.reason],
    );
    if (input.reason === 'archive') {
      await tx.query(`UPDATE products SET status = 'archived', updated_at = now() WHERE id = $1`, [input.productId]);
    }
    await audit(tx, { actor: input.actor, action: `product.${input.reason}_requested`, subjectType: 'product', subjectId: input.productId, details: { publicationId, versionNo } });
    return { publicationId, versionNo };
  });
  await trigger(deps, log, created.publicationId);
  const { rows } = await db.query<{ status: string }>('SELECT status FROM publications WHERE id = $1', [created.publicationId]);
  return { publicationId: created.publicationId, versionNo: created.versionNo, status: rows[0].status };
}

/** Sends the build request with the publication ID as idempotency key. A failure stays visible; the owner can retry. */
async function trigger(deps: Deps, log: Logger, publicationId: string): Promise<void> {
  const db = deps.db();
  await db.query(`UPDATE publications SET attempts = attempts + 1, updated_at = now() WHERE id = $1`, [publicationId]);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
  try {
    const result = await deps.publish().triggerBuild({ idempotencyKey: publicationId, publicationId }, controller.signal);
    await db.query(`UPDATE publications SET status = 'building', build_url = $2, last_error = NULL, updated_at = now() WHERE id = $1 AND status <> 'succeeded'`, [publicationId, result.runUrl]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Build trigger failed';
    await db.query(`UPDATE publications SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1 AND status <> 'succeeded'`, [publicationId, message]);
    log.warn('publication_trigger_failed', { publicationId });
  } finally {
    clearTimeout(timer);
  }
}

/** Owner retry of a failed publication. Same publication ID, so the build cannot duplicate a version. */
export async function retryPublication(deps: Deps, log: Logger, publicationId: string, actor: string): Promise<{ status: string }> {
  const db = deps.db();
  const { rows } = await db.query<{ status: string; product_id: string }>('SELECT status, product_id FROM publications WHERE id = $1', [publicationId]);
  if (!rows[0]) throw apiErrors.notFound();
  if (rows[0].status !== 'failed') throw apiErrors.conflict('Only a failed publication can be retried.');
  await audit(db, { actor, action: 'publication.retry', subjectType: 'product', subjectId: rows[0].product_id, details: { publicationId } });
  await db.query(`UPDATE publications SET status = 'queued' WHERE id = $1`, [publicationId]);
  await trigger(deps, log, publicationId);
  const after = await db.query<{ status: string }>('SELECT status FROM publications WHERE id = $1', [publicationId]);
  return { status: after.rows[0].status };
}

/**
 * Build callback. The public pointer advances only for a newer, successful version, so an old or repeated callback
 * can never roll the public site back. Failures keep the last successful version live.
 */
export async function recordResult(
  db: Db,
  input: { publicationId: string; outcome: 'succeeded' | 'failed'; buildUrl?: string | null; error?: string | null },
): Promise<{ accepted: boolean }> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ product_id: string; version_no: number; status: string }>(
      'SELECT product_id, version_no, status FROM publications WHERE id = $1 FOR UPDATE',
      [input.publicationId],
    );
    const pub = rows[0];
    if (!pub) throw apiErrors.notFound();
    if (pub.status === 'succeeded') return { accepted: false };
    if (input.outcome === 'succeeded') {
      await tx.query(
        `UPDATE publications SET status = 'succeeded', build_url = $2, last_error = NULL, updated_at = now() WHERE id = $1`,
        [input.publicationId, input.buildUrl ?? null],
      );
      await tx.query(
        `UPDATE products SET published_version = $2,
                status = CASE WHEN status = 'draft' THEN 'published' ELSE status END, updated_at = now()
          WHERE id = $1 AND (published_version IS NULL OR published_version < $2)`,
        [pub.product_id, pub.version_no],
      );
    } else {
      await tx.query(
        `UPDATE publications SET status = 'failed', last_error = $2, build_url = $3, updated_at = now() WHERE id = $1`,
        [input.publicationId, (input.error ?? 'Build failed').slice(0, 300), input.buildUrl ?? null],
      );
    }
    return { accepted: true };
  });
}
