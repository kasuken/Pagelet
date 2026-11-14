import type { Db, Tx } from '../core/db.js';
import { apiErrors } from '../core/errors.js';

type Queryable = Db | Tx;

export type EntitlementStatus = 'active' | 'suspended' | 'revoked';

/**
 * Recomputes the effective entitlement for one customer and product from its grants, inside the caller's
 * transaction. Any active grant wins; otherwise a suspended grant (open dispute) suspends access; otherwise
 * the entitlement is revoked. Unrelated grants for the same product are not touched by a single revocation.
 */
export async function recomputeEntitlement(tx: Tx, customerId: string, productId: string): Promise<EntitlementStatus | null> {
  const { rows } = await tx.query<{ status: 'active' | 'suspended' | 'revoked' }>(
    `SELECT status FROM entitlement_grants WHERE customer_id = $1 AND product_id = $2`,
    [customerId, productId],
  );
  const statuses = new Set(rows.map((r) => r.status));
  let effective: EntitlementStatus | null;
  if (statuses.has('active')) effective = 'active';
  else if (statuses.has('suspended')) effective = 'suspended';
  else if (rows.length > 0) effective = 'revoked';
  else effective = null;

  if (effective === null) {
    await tx.query('DELETE FROM entitlements WHERE customer_id = $1 AND product_id = $2', [customerId, productId]);
    return null;
  }
  await tx.query(
    `INSERT INTO entitlements (customer_id, product_id, status, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (customer_id, product_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
    [customerId, productId, effective],
  );
  return effective;
}

export interface LibraryRow {
  productId: string;
  slug: string;
  productType: 'course' | 'download';
  title: string;
  status: EntitlementStatus;
  grantedAt: string;
}

/** The buyer's own library. Archived products keep access; drafts are never sold, so never listed. */
export async function customerLibrary(db: Queryable, customerId: string): Promise<LibraryRow[]> {
  const { rows } = await db.query<{
    product_id: string;
    slug: string;
    product_type: 'course' | 'download';
    title: string;
    status: EntitlementStatus;
    granted_at: Date;
  }>(
    `SELECT e.product_id, p.slug, p.product_type, p.title, e.status,
            (SELECT min(g.created_at) FROM entitlement_grants g WHERE g.customer_id = e.customer_id AND g.product_id = e.product_id) AS granted_at
       FROM entitlements e JOIN products p ON p.id = e.product_id
      WHERE e.customer_id = $1 AND p.status IN ('published', 'archived')
      ORDER BY granted_at DESC, p.title`,
    [customerId],
  );
  return rows.map((r) => ({
    productId: r.product_id,
    slug: r.slug,
    productType: r.product_type,
    title: r.title,
    status: r.status,
    grantedAt: r.granted_at.toISOString(),
  }));
}

/** Throws not_found for missing, foreign, revoked or suspended access, so resource IDs cannot be probed. */
export async function assertProductAccess(db: Queryable, customerId: string, productId: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1 FROM entitlements e JOIN products p ON p.id = e.product_id
      WHERE e.customer_id = $1 AND e.product_id = $2 AND e.status = 'active' AND p.status IN ('published','archived')`,
    [customerId, productId],
  );
  if (rows.length === 0) throw apiErrors.notFound();
}

/** Resolves a lesson to its product and checks the buyer's active entitlement. Guessing another lesson fails. */
export async function assertLessonAccess(db: Queryable, customerId: string, lessonId: string): Promise<{ productId: string; sectionId: string }> {
  const { rows } = await db.query<{ product_id: string; section_id: string }>(
    `SELECT l.product_id, l.section_id
       FROM lessons l
       JOIN entitlements e ON e.product_id = l.product_id AND e.customer_id = $2 AND e.status = 'active'
       JOIN products p ON p.id = l.product_id AND p.status IN ('published','archived')
      WHERE l.id = $1`,
    [lessonId, customerId],
  );
  const row = rows[0];
  if (!row) throw apiErrors.notFound();
  return { productId: row.product_id, sectionId: row.section_id };
}
