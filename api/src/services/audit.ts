import { redact } from '../core/logger.js';
import type { Db, Tx } from '../core/db.js';

export interface AuditEntry {
  actor: string;
  action: string;
  subjectType: string;
  subjectId: string;
  details?: Record<string, unknown>;
}

/** Appends an audit event inside the caller's transaction. Details are redacted before storage. */
export async function audit(tx: Tx | Db, entry: AuditEntry): Promise<void> {
  await tx.query(
    `INSERT INTO audit_events (actor, action, subject_type, subject_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [entry.actor, entry.action, entry.subjectType, entry.subjectId, JSON.stringify(redact(entry.details ?? {}))],
  );
}
