import { randomUUID } from 'node:crypto';
import type { Db, Tx } from '../core/db.js';
import { isUniqueViolation } from '../core/db.js';
import type { MailMessage, MailPort } from '../core/ports.js';
import { redact } from '../core/logger.js';

export const SEND_TIMEOUT_MS = 8_000;
const MAX_ERROR_LENGTH = 300;

export interface OutboxRecord {
  id: string;
  dedupeKey: string;
  recipient: string;
  template: string;
  payload: Record<string, unknown>;
}

/**
 * Writes an outbox row. Call inside the same transaction as the business change, so a rollback never leaves
 * an email for an order that does not exist and a commit never loses one. Payloads must not hold raw tokens.
 * Returns null when the same dedupe key already exists (duplicate webhook or retry).
 */
export async function enqueue(tx: Tx, record: Omit<OutboxRecord, 'id'>): Promise<OutboxRecord | null> {
  const id = randomUUID();
  try {
    await tx.query(
      `INSERT INTO email_outbox (id, dedupe_key, recipient_email_normalized, template, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [id, record.dedupeKey, record.recipient, record.template, JSON.stringify(redact(record.payload))],
    );
  } catch (error) {
    if (isUniqueViolation(error)) return null;
    throw error;
  }
  return { id, ...record };
}

/**
 * Attempts synchronous delivery with a bounded timeout. Failures are recorded and surfaced to the owner;
 * they never roll back the business transaction that produced the message.
 */
export async function deliver(db: Db, mail: MailPort, row: { id: string; message: MailMessage }): Promise<'sent' | 'failed'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const result = await mail.send(row.message, controller.signal);
    await db.query(
      `UPDATE email_outbox SET status = 'sent', attempts = attempts + 1, sent_at = now(),
              provider_message_id = $2, last_error = NULL WHERE id = $1`,
      [row.id, result.providerMessageId],
    );
    return 'sent';
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Delivery failed').slice(0, MAX_ERROR_LENGTH);
    await db.query(
      `UPDATE email_outbox SET status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`,
      [row.id, redact(message)],
    );
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

/** Retries a failed delivery on the owner's request. The idempotency key is the row ID, so a repeat cannot double-send. */
export async function retryFailed(db: Db, mail: MailPort, id: string, rebuild: () => Promise<MailMessage | null>): Promise<'sent' | 'failed' | 'not_retryable'> {
  const { rows } = await db.query<{ status: string }>('SELECT status FROM email_outbox WHERE id = $1', [id]);
  if (!rows[0] || rows[0].status !== 'failed') return 'not_retryable';
  const message = await rebuild();
  if (!message) return 'not_retryable';
  return deliver(db, mail, { id, message });
}
