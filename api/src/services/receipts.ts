import type { Db } from '../core/db.js';
import { apiErrors } from '../core/errors.js';

export interface ReceiptItem {
  productId: string;
  title: string;
  unitPrice: { amountMinor: number; currency: string };
}

export interface Receipt {
  id: string;
  createdAt: string;
  status: string;
  total: { amountMinor: number; currency: string };
  refunded: { amountMinor: number; currency: string };
  items: ReceiptItem[];
}

const SELECT_RECEIPTS = `
  SELECT o.id, o.created_at, o.status, o.amount_minor, o.refunded_minor, o.currency,
         COALESCE(json_agg(json_build_object('productId', oi.product_id, 'title', oi.title_snapshot,
                  'amount', oi.unit_price_minor)) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
    FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id`;

function toReceipt(row: any): Receipt {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    status: row.status,
    total: { amountMinor: row.amount_minor, currency: row.currency },
    refunded: { amountMinor: row.refunded_minor, currency: row.currency },
    items: row.items.map((i: any) => ({ productId: i.productId, title: i.title, unitPrice: { amountMinor: i.amount, currency: row.currency } })),
  };
}

/** Receipts show only the buyer's own purchase facts: no card data and no provider identifiers. */
export async function customerReceipts(db: Db, customerId: string): Promise<Receipt[]> {
  const { rows } = await db.query(`${SELECT_RECEIPTS} WHERE o.customer_id = $1 GROUP BY o.id ORDER BY o.created_at DESC`, [customerId]);
  return rows.map(toReceipt);
}

export async function customerReceipt(db: Db, customerId: string, orderId: string): Promise<Receipt> {
  const { rows } = await db.query(`${SELECT_RECEIPTS} WHERE o.customer_id = $1 AND o.id = $2 GROUP BY o.id`, [customerId, orderId]);
  if (!rows[0]) throw apiErrors.notFound();
  return toReceipt(rows[0]);
}
