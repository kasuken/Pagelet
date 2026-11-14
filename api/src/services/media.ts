import { randomUUID } from 'node:crypto';
import type { Db, Tx } from '../core/db.js';
import { withTransaction } from '../core/db.js';
import { apiErrors, type Issue } from '../core/errors.js';
import type { AppConfig } from '../core/config.js';
import type { BlobPort } from '../core/ports.js';
import { redact } from '../core/logger.js';
import { audit } from './audit.js';
import { assertLessonAccess, assertProductAccess } from './entitlements.js';
import { conflict, removeBlobs } from './catalog.js';

export type AssetKind = 'file' | 'video' | 'caption' | 'cover' | 'logo';

export const UPLOAD_WINDOW_SECONDS = 15 * 60;
export const DOWNLOAD_WINDOW_SECONDS = 5 * 60;
export const PLAYBACK_WINDOW_SECONDS = 15 * 60;
/** A claim older than this is considered abandoned and may be finalized again. */
export const FINALIZE_CLAIM_SECONDS = 5 * 60;
const DEFAULT_QUOTA_BYTES = 10 * 1024 ** 3;
const SIGNATURE_BYTES = 16;

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** Accepted MIME types and size caps per asset kind. Active content (HTML, SVG, executables) is never listed. */
export const MEDIA_RULES: Record<AssetKind, { mimeTypes: string[]; maxBytes: number }> = {
  file: {
    mimeTypes: ['application/pdf', 'application/epub+zip', 'application/zip', 'audio/mpeg', 'image/png', 'image/jpeg'],
    maxBytes: 2 * GIB,
  },
  video: { mimeTypes: ['video/mp4'], maxBytes: 4 * GIB },
  caption: { mimeTypes: ['text/vtt'], maxBytes: 1 * MIB },
  cover: { mimeTypes: ['image/png', 'image/jpeg'], maxBytes: 10 * MIB },
  logo: { mimeTypes: ['image/png', 'image/jpeg'], maxBytes: 2 * MIB },
};

const EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'application/zip': 'zip',
  'audio/mpeg': 'mp3',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'video/mp4': 'mp4',
  'text/vtt': 'vtt',
};

export interface AssetView {
  id: string;
  kind: AssetKind;
  status: string;
  productId: string | null;
  mimeType: string;
  declaredBytes: number;
  actualBytes: number | null;
  versionLabel: string;
  replacesAssetId: string | null;
  createdAt: string;
  finalizedAt: string | null;
}

interface AssetRow {
  id: string;
  kind: AssetKind;
  status: string;
  product_id: string | null;
  object_key: string;
  mime_type: string;
  declared_bytes: string;
  actual_bytes: string | null;
  version_label: string;
  replaces_asset_id: string | null;
  created_at: Date;
  finalized_at: Date | null;
}

function view(row: AssetRow): AssetView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    productId: row.product_id,
    mimeType: row.mime_type,
    declaredBytes: Number(row.declared_bytes),
    actualBytes: row.actual_bytes === null ? null : Number(row.actual_bytes),
    versionLabel: row.version_label,
    replacesAssetId: row.replaces_asset_id,
    createdAt: row.created_at.toISOString(),
    finalizedAt: row.finalized_at?.toISOString() ?? null,
  };
}

export function quotaBytes(config: AppConfig): number {
  const raw = config.env.MEDIA_QUOTA_BYTES;
  return raw ? Number(raw) : DEFAULT_QUOTA_BYTES;
}

/** Bytes counted against the quota: reserved declared bytes for in-flight uploads, actual bytes once stored. */
async function usedBytes(q: Db | Tx, excludeId: string | null): Promise<number> {
  const { rows } = await q.query<{ used: string }>(
    `SELECT COALESCE(SUM(COALESCE(actual_bytes, declared_bytes)), 0)::text AS used
       FROM assets WHERE status IN ('pending_upload','quarantined','ready') AND ($1::uuid IS NULL OR id <> $1)`,
    [excludeId],
  );
  return Number(rows[0]!.used);
}

/** Refuses or allows new bytes under one advisory lock, so concurrent issuance cannot overshoot the quota. */
async function lockQuota(tx: Tx): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('pagelet-media-quota'))`);
}

/** SQL fragment: true when an asset is still referenced by live content, so it must not be removed. */
const REFERENCED = `(
  EXISTS (SELECT 1 FROM lessons l WHERE l.video_asset_id = a.id OR l.caption_asset_id = a.id)
  OR EXISTS (SELECT 1 FROM lesson_resources r WHERE r.asset_id = a.id)
  OR EXISTS (SELECT 1 FROM products p WHERE p.cover_asset_id = a.id)
  OR EXISTS (SELECT 1 FROM shop_settings s WHERE s.logo_asset_id = a.id)
  OR EXISTS (SELECT 1 FROM assets r2 WHERE r2.replaces_asset_id = a.id)
)`;

/** Downloadable filename derived from the product's fields and never from client text. */
export function downloadFilename(title: string, versionLabel: string, mimeType: string): string {
  const ext = EXTENSION[mimeType] ?? 'bin';
  const base = `${title}-${versionLabel}`
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return `${base || 'download'}.${ext}`;
}

// ---- Issuance ----------------------------------------------------------------

export interface UploadInput {
  kind: AssetKind;
  productId?: string | undefined;
  mimeType: string;
  declaredBytes: number;
  versionLabel: string;
  replacesAssetId?: string | undefined;
}

export async function issueUpload(db: Db, blob: BlobPort, config: AppConfig, input: UploadInput, actor = 'owner') {
  const rules = MEDIA_RULES[input.kind];
  const issues: Issue[] = [];
  if (!rules.mimeTypes.includes(input.mimeType)) issues.push({ path: 'mimeType', message: `Upload ${rules.mimeTypes.join(', ')} for this kind.` });
  if (input.declaredBytes > rules.maxBytes) issues.push({ path: 'declaredBytes', message: `This file is larger than the ${Math.floor(rules.maxBytes / MIB)} MiB limit for this kind.` });
  if ((input.kind === 'logo') !== (input.productId === undefined)) {
    issues.push({ path: 'productId', message: input.kind === 'logo' ? 'A logo belongs to the shop, not a product.' : 'Choose the product this file belongs to.' });
  }
  if (issues.length) throw apiErrors.validation(issues);

  const id = randomUUID();
  const quota = quotaBytes(config);
  const { asset, objectKey } = await withTransaction(db, async (tx) => {
    if (input.productId) {
      const { rows } = await tx.query<{ status: string }>('SELECT status FROM products WHERE id = $1 FOR UPDATE', [input.productId]);
      if (!rows[0]) throw apiErrors.validation([{ path: 'productId', message: 'Choose an existing product.' }]);
      if (rows[0].status === 'archived') throw conflict('Archived products cannot receive new files.');
    }
    if (input.replacesAssetId) {
      const { rows } = await tx.query<{ kind: string; status: string; product_id: string }>(
        'SELECT kind, status, product_id FROM assets WHERE id = $1',
        [input.replacesAssetId],
      );
      if (!rows[0] || rows[0].kind !== 'file' || rows[0].status !== 'ready' || rows[0].product_id !== input.productId) {
        throw apiErrors.validation([{ path: 'replacesAssetId', message: 'Only a ready file of this product can be replaced.' }]);
      }
    }
    await lockQuota(tx);
    const used = await usedBytes(tx, null);
    if (used + input.declaredBytes > quota) {
      throw conflict('Storage quota would be exceeded. Remove unused files or raise the quota before uploading.', [
        { path: 'declaredBytes', message: 'Not enough storage quota for this file.' },
      ]);
    }
    // The object key is derived on the server from the asset ID; the client never supplies it.
    const key = `${input.kind}/${input.productId ?? 'shop'}/${id}`;
    const { rows } = await tx.query<AssetRow>(
      `INSERT INTO assets (id, product_id, kind, object_key, status, mime_type, declared_bytes, version_label, replaces_asset_id)
       VALUES ($1, $2, $3, $4, 'pending_upload', $5, $6, $7, $8) RETURNING *`,
      [id, input.productId ?? null, input.kind, key, input.mimeType, input.declaredBytes, input.versionLabel, input.replacesAssetId ?? null],
    );
    await audit(tx, { actor, action: 'asset.upload_issued', subjectType: 'asset', subjectId: id, details: { kind: input.kind, declaredBytes: input.declaredBytes, mimeType: input.mimeType } });
    return { asset: rows[0]!, objectKey: key };
  });
  // Issued after commit so a failed signing leaves a pending row that cleanup removes later.
  const url = await blob.issueUploadUrl(objectKey, UPLOAD_WINDOW_SECONDS, input.mimeType, input.declaredBytes);
  return {
    asset: view(asset),
    upload: {
      url,
      method: 'PUT' as const,
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': input.mimeType },
      expiresAt: new Date(Date.now() + UPLOAD_WINDOW_SECONDS * 1000).toISOString(),
    },
  };
}

// ---- Finalization --------------------------------------------------------------

/** Content signatures for the accepted types. MP4 and WebVTT are checked structurally, not decoded. */
export function signatureMatches(mimeType: string, head: Buffer): boolean {
  const startsWith = (sig: number[], offset = 0) => head.length >= offset + sig.length && sig.every((b, i) => head[offset + i] === b);
  switch (mimeType) {
    case 'application/pdf':
      return head.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'application/zip':
    case 'application/epub+zip':
      return startsWith([0x50, 0x4b, 0x03, 0x04]);
    case 'audio/mpeg':
      return head.subarray(0, 3).toString('latin1') === 'ID3' || (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0);
    case 'image/png':
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith([0xff, 0xd8, 0xff]);
    case 'video/mp4':
      return head.length >= 8 && head.subarray(4, 8).toString('latin1') === 'ftyp';
    case 'text/vtt': {
      let text = head.toString('utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      return /^WEBVTT(?:[ \t\r\n]|$)/.test(text);
    }
    default:
      return false;
  }
}

/**
 * Finalize state machine:
 *   pending_upload --claim--> quarantined --validation ok--> ready
 *                                       \--validation failed--> rejected (blob deleted)
 *   quarantined --blob not yet present--> pending_upload (owner may retry)
 * A quarantined claim older than FINALIZE_CLAIM_SECONDS is treated as abandoned and may be claimed again.
 */
export async function finalizeUpload(db: Db, blob: BlobPort, config: AppConfig, assetId: string, actor = 'owner'): Promise<AssetView> {
  // Phase 1: claim the asset under a row lock.
  const claimed = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<AssetRow>('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
    const row = rows[0];
    if (!row) throw apiErrors.notFound('Upload not found.');
    const staleClaim = row.status === 'quarantined' && row.finalized_at !== null && Date.now() - row.finalized_at.getTime() > FINALIZE_CLAIM_SECONDS * 1000;
    if (row.status !== 'pending_upload' && !staleClaim) {
      throw conflict(row.status === 'quarantined' ? 'This upload is already being checked. Try again in a moment.' : `This upload is ${row.status} and cannot be finalized.`);
    }
    const { rows: updated } = await tx.query<AssetRow>(
      `UPDATE assets SET status = 'quarantined', finalized_at = now() WHERE id = $1 RETURNING *`,
      [assetId],
    );
    return updated[0]!;
  });

  // Phase 2: inspect the stored object outside the transaction.
  const rules = MEDIA_RULES[claimed.kind];
  const declared = Number(claimed.declared_bytes);
  let stored: { bytes: number; contentType: string } | null;
  let head: Buffer;
  try {
    stored = await blob.inspect(claimed.object_key);
    head = stored ? await blob.readHead(claimed.object_key, SIGNATURE_BYTES) : Buffer.alloc(0);
  } catch {
    await revertClaim(db, assetId);
    throw apiErrors.unavailable('Storage could not be checked right now. Try finalizing again.');
  }
  if (!stored) {
    await revertClaim(db, assetId);
    throw conflict('The file has not reached storage yet. Finish the upload, then finalize again.');
  }

  const failures: Issue[] = [];
  const storedType = stored.contentType.split(';')[0]!.trim().toLowerCase();
  if (stored.bytes !== declared) failures.push({ path: 'file', message: `The stored file is ${stored.bytes} bytes but ${declared} were declared.` });
  if (storedType !== claimed.mime_type) failures.push({ path: 'file', message: `The stored content type (${storedType || 'none'}) does not match ${claimed.mime_type}.` });
  if (stored.bytes > rules.maxBytes) failures.push({ path: 'file', message: 'The stored file is larger than the limit for this kind.' });
  if (!rules.mimeTypes.includes(claimed.mime_type) || !signatureMatches(claimed.mime_type, head)) {
    failures.push({ path: 'file', message: 'The file contents do not match the declared type.' });
  }

  // Phase 3: commit the outcome. Quota is rechecked under the lock because other uploads may have finished meanwhile.
  const outcome = await withTransaction(db, async (tx) => {
    if (failures.length === 0) {
      await lockQuota(tx);
      const used = await usedBytes(tx, assetId);
      if (used + stored!.bytes > quotaBytes(config)) {
        failures.push({ path: 'declaredBytes', message: 'Storage quota is exceeded, so this file cannot be kept.' });
      }
    }
    const status = failures.length === 0 ? 'ready' : 'rejected';
    const { rows } = await tx.query<AssetRow>(
      `UPDATE assets SET status = $2, actual_bytes = $3 WHERE id = $1 AND status = 'quarantined' RETURNING *`,
      [assetId, status, stored!.bytes],
    );
    if (!rows[0]) throw conflict('The upload changed while it was being checked. Reload and try again.');
    await audit(tx, {
      actor,
      action: status === 'ready' ? 'asset.ready' : 'asset.rejected',
      subjectType: 'asset',
      subjectId: assetId,
      details: redact({ kind: claimed.kind, reasons: failures.map((f) => f.message) }) as Record<string, unknown>,
    });
    return { row: rows[0], status };
  });

  if (outcome.status === 'rejected') {
    await removeBlobs(() => blob, [claimed.object_key]);
    throw apiErrors.validation(failures);
  }
  return view(outcome.row);
}

async function revertClaim(db: Db, assetId: string): Promise<void> {
  await db.query(`UPDATE assets SET status = 'pending_upload', finalized_at = NULL WHERE id = $1 AND status = 'quarantined'`, [assetId]);
}

// ---- Owner removal --------------------------------------------------------------

/** Aborts an unfinished upload or clears a rejected one. Ready assets are removed through deleteAsset instead. */
export async function abortUpload(db: Db, blob: BlobPort, assetId: string, actor = 'owner'): Promise<void> {
  const key = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<AssetRow>('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
    const row = rows[0];
    if (!row) throw apiErrors.notFound('Upload not found.');
    if (row.status === 'quarantined') throw conflict('This upload is being checked. Try again in a moment.');
    if (row.status !== 'pending_upload' && row.status !== 'rejected') throw conflict('Only an unfinished or rejected upload can be aborted.');
    const { rows: refs } = await tx.query<{ referenced: boolean }>(`SELECT ${REFERENCED} AS referenced FROM assets a WHERE a.id = $1`, [assetId]);
    if (refs[0]?.referenced) throw conflict('This file is in use and cannot be removed.');
    await tx.query('DELETE FROM assets WHERE id = $1', [assetId]);
    await audit(tx, { actor, action: 'asset.aborted', subjectType: 'asset', subjectId: assetId, details: { status: row.status } });
    return row.object_key;
  });
  await removeBlobs(() => blob, [key]);
}

/** Removes a ready file that no sale or live content depends on. Sold products keep their files. */
export async function deleteAsset(db: Db, blob: BlobPort, assetId: string, actor = 'owner'): Promise<void> {
  const key = await withTransaction(db, async (tx) => {
    const { rows } = await tx.query<AssetRow>('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [assetId]);
    const row = rows[0];
    if (!row || row.status === 'deleted') throw apiErrors.notFound('File not found.');
    if (row.status !== 'ready') throw conflict('Only a ready file can be deleted this way. Abort unfinished uploads instead.');
    if (row.product_id) {
      const sold = await tx.query<{ n: string }>(
        `SELECT (SELECT count(*) FROM order_items WHERE product_id = $1) + (SELECT count(*) FROM entitlement_grants WHERE product_id = $1) AS n`,
        [row.product_id],
      );
      if (Number(sold.rows[0]!.n) > 0) throw conflict('This product has been sold, so its files cannot be deleted. Upload a replacement version instead.');
    }
    const { rows: refs } = await tx.query<{ referenced: boolean }>(`SELECT ${REFERENCED} AS referenced FROM assets a WHERE a.id = $1`, [assetId]);
    if (refs[0]?.referenced) throw conflict('This file is still used by a lesson, cover or logo. Remove that use first.');
    await tx.query(`UPDATE assets SET status = 'deleted' WHERE id = $1`, [assetId]);
    await audit(tx, { actor, action: 'asset.deleted', subjectType: 'asset', subjectId: assetId, details: { kind: row.kind } });
    return row.object_key;
  });
  await removeBlobs(() => blob, [key]);
}

// ---- Quota and lifecycle -----------------------------------------------------------

export async function mediaUsage(db: Db, config: AppConfig) {
  const used = await usedBytes(db, null);
  const { rows } = await db.query<{ failed: string; abandoned: string; unused: string }>(
    `SELECT
       (SELECT count(*) FROM assets WHERE status = 'rejected')::text AS failed,
       (SELECT count(*) FROM assets WHERE status IN ('pending_upload','quarantined') AND created_at < now() - interval '24 hours')::text AS abandoned,
       (SELECT count(*) FROM assets a WHERE a.status = 'ready' AND NOT ${REFERENCED}
          AND (a.kind <> 'file' OR EXISTS (SELECT 1 FROM assets r WHERE r.replaces_asset_id = a.id)))::text AS unused`,
  );
  return {
    quotaBytes: quotaBytes(config),
    usedBytes: used,
    uploadLimits: Object.fromEntries(
      (Object.keys(MEDIA_RULES) as AssetKind[]).map((k) => [k, { mimeTypes: MEDIA_RULES[k].mimeTypes, maxBytes: MEDIA_RULES[k].maxBytes }]),
    ),
    failedUploads: Number(rows[0]!.failed),
    abandonedUploads: Number(rows[0]!.abandoned),
    unusedCandidates: Number(rows[0]!.unused),
  };
}

/**
 * Manual, owner-confirmed cleanup. Removes rejected and abandoned unfinished uploads older than the age.
 * Ready assets are never candidates, and any row still referenced by live content is kept.
 */
export async function runCleanup(db: Db, blob: BlobPort, olderThanHours: number, actor = 'owner') {
  const { rows: candidates } = await db.query<{ id: string; status: string }>(
    `SELECT a.id, a.status FROM assets a
      WHERE (a.status IN ('pending_upload','rejected') AND a.created_at < now() - make_interval(hours => $1))
         OR (a.status = 'quarantined' AND a.finalized_at < now() - make_interval(hours => $1))
      ORDER BY a.created_at LIMIT 200`,
    [olderThanHours],
  );
  const removed = { pendingUploads: 0, rejected: 0, quarantined: 0 };
  let skippedReferenced = 0;
  const keys: string[] = [];
  for (const c of candidates) {
    const key = await withTransaction(db, async (tx: Tx) => {
      const { rows } = await tx.query<{ object_key: string }>(
        `DELETE FROM assets a WHERE a.id = $1 AND a.status = $2 AND NOT ${REFERENCED} RETURNING a.object_key`,
        [c.id, c.status],
      );
      if (rows[0]) return rows[0].object_key;
      skippedReferenced += 1;
      return null;
    });
    if (key) {
      keys.push(key);
      if (c.status === 'pending_upload') removed.pendingUploads += 1;
      else if (c.status === 'rejected') removed.rejected += 1;
      else removed.quarantined += 1;
    }
  }
  await removeBlobs(() => blob, keys);
  await withTransaction(db, async (tx) => {
    await audit(tx, {
      actor,
      action: 'media.cleanup',
      subjectType: 'media',
      subjectId: 'installation',
      details: { olderThanHours, scanned: candidates.length, removed, skippedReferenced },
    });
  });
  return { scanned: candidates.length, removed, skippedReferenced };
}

// ---- Read URLs for entitled customers -----------------------------------------------

/**
 * Five-minute, single-blob read link for a file the customer may download. Draft, revoked, foreign and
 * unknown assets all return not_found. Pinned products only expose files that were ready before the purchase.
 */
export async function issueDownloadUrl(db: Db, blob: BlobPort, customerId: string, assetId: string) {
  const { rows } = await db.query<AssetRow & { title: string; update_policy: string }>(
    `SELECT a.*, p.title, p.update_policy FROM assets a JOIN products p ON p.id = a.product_id
      WHERE a.id = $1 AND a.kind = 'file' AND a.status = 'ready'`,
    [assetId],
  );
  const row = rows[0];
  if (!row || !row.product_id) throw apiErrors.notFound();
  await assertProductAccess(db, customerId, row.product_id);
  if (row.update_policy === 'pinned') {
    const { rows: grant } = await db.query<{ first: Date }>(
      `SELECT min(created_at) AS first FROM entitlement_grants WHERE customer_id = $1 AND product_id = $2`,
      [customerId, row.product_id],
    );
    const purchasedAt = grant[0]?.first;
    if (!purchasedAt || !row.finalized_at || row.finalized_at > purchasedAt) throw apiErrors.notFound();
  }
  const url = await blob.issueReadUrl(row.object_key, DOWNLOAD_WINDOW_SECONDS, downloadFilename(row.title, row.version_label, row.mime_type));
  return { url, expiresAt: new Date(Date.now() + DOWNLOAD_WINDOW_SECONDS * 1000).toISOString() };
}

/**
 * Playback or caption link for a lesson's media. Rechecks the entitlement on every call, so a refresh after
 * revocation fails. Returns the stored resume position so a refresh does not reset the player.
 */
export async function issuePlaybackUrl(db: Db, blob: BlobPort, customerId: string, lessonId: string, track: 'video' | 'caption') {
  await assertLessonAccess(db, customerId, lessonId);
  const column = track === 'video' ? 'video_asset_id' : 'caption_asset_id';
  const { rows } = await db.query<AssetRow & { title: string }>(
    `SELECT a.*, '' AS title FROM lessons l JOIN assets a ON a.id = l.${column}
      WHERE l.id = $1 AND a.status = 'ready'`,
    [lessonId],
  );
  const row = rows[0];
  if (!row) throw apiErrors.notFound();
  const { rows: progress } = await db.query<{ resume_seconds: number }>(
    'SELECT resume_seconds FROM lesson_progress WHERE customer_id = $1 AND lesson_id = $2',
    [customerId, lessonId],
  );
  const url = await blob.issueReadUrl(row.object_key, PLAYBACK_WINDOW_SECONDS, downloadFilename(`lesson-${track}`, 'v1', row.mime_type));
  return {
    url,
    expiresAt: new Date(Date.now() + PLAYBACK_WINDOW_SECONDS * 1000).toISOString(),
    resumeSeconds: progress[0]?.resume_seconds ?? 0,
  };
}

/** Saves a bounded resume position for the customer. Access is checked first. */
export async function recordResumePosition(db: Db, customerId: string, lessonId: string, seconds: number): Promise<void> {
  await assertLessonAccess(db, customerId, lessonId);
  const bounded = Math.min(86_400, Math.max(0, Math.floor(seconds)));
  await db.query(
    `INSERT INTO lesson_progress (customer_id, lesson_id, resume_seconds, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (customer_id, lesson_id) DO UPDATE SET resume_seconds = EXCLUDED.resume_seconds, updated_at = now()`,
    [customerId, lessonId, bounded],
  );
}
