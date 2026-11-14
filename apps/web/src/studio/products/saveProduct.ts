import { api } from '../../lib/api';
import type { OwnerProductDetail } from '../../lib/types';
import { isStaleConflict, StaleRevisionError } from '../common';

/** PATCH with the revision the owner saw; the API answers 409 when someone saved in between. */
export async function saveProduct(product: { id: string; revision: number }, changes: Record<string, unknown>): Promise<OwnerProductDetail> {
  try {
    const { product: saved } = await api<{ product: OwnerProductDetail }>(`/api/owner/products/${encodeURIComponent(product.id)}`, {
      method: 'PATCH',
      body: { revision: product.revision, ...changes },
    });
    return saved;
  } catch (error) {
    // Other 409s (archived, type change blocked) also have no field issues: check the revision before
    // telling the owner someone else saved.
    if (isStaleConflict(error)) {
      const latest = await api<{ product: OwnerProductDetail }>(`/api/owner/products/${encodeURIComponent(product.id)}`).catch(() => null);
      if (latest && latest.product.revision > product.revision) throw new StaleRevisionError(error);
    }
    throw error;
  }
}
