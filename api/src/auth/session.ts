import { createHash, randomBytes } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';
import type { Db, Tx } from '../core/db.js';
import { apiErrors } from '../core/errors.js';

export const SESSION_COOKIE = '__Host-pagelet_session';
export const SESSION_TTL_DAYS = 30;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function sessionCookie(value: string, maxAgeSeconds: number) {
  return {
    name: SESSION_COOKIE,
    value,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
    maxAge: maxAgeSeconds,
  };
}

export function clearSessionCookie() {
  return { ...sessionCookie('', 0), expires: new Date(0) };
}

export function readCookie(request: HttpRequest, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** Creates a new server-side session row for a customer. Only the hash is stored. */
export async function createSession(tx: Tx, customerId: string): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = randomToken(32);
  const maxAgeSeconds = SESSION_TTL_DAYS * 24 * 60 * 60;
  await tx.query(
    `INSERT INTO sessions (id_hash, customer_id, expires_at)
     VALUES ($1, $2, now() + make_interval(secs => $3))`,
    [sha256(token), customerId, maxAgeSeconds],
  );
  return { token, maxAgeSeconds };
}

export async function revokeSession(db: Db | Tx, token: string | null): Promise<void> {
  if (!token) return;
  await db.query('UPDATE sessions SET revoked_at = now() WHERE id_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
}

export interface CustomerSession {
  customerId: string;
  email: string;
}

/** Resolves the current customer. Expired, revoked and missing sessions all fail the same way. */
export async function requireCustomer(db: Db, request: HttpRequest): Promise<CustomerSession> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) throw apiErrors.unauthorized('Sign in with your email to continue.');
  const { rows } = await db.query<{ customer_id: string; email_normalized: string }>(
    `SELECT s.customer_id, c.email_normalized
       FROM sessions s JOIN customers c ON c.id = s.customer_id
      WHERE s.id_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) throw apiErrors.unauthorized('Your session has expired. Sign in again to continue.');
  return { customerId: row.customer_id, email: row.email_normalized };
}

/** Masks an address for display: a***@example.com. The mask length is fixed so it does not reveal the local-part length. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
