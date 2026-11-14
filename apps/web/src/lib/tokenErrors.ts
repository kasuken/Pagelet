import { isApiError } from './api';

export type TokenFailure = 'expired' | 'malformed' | 'other';

/**
 * POST /api/auth/sessions and /api/free-claims/confirm: 401 means the token is expired, used or unknown;
 * 400 validation_failed means the link is incomplete. Everything else is a normal, retryable failure.
 */
export function tokenFailure(error: unknown): TokenFailure {
  if (!isApiError(error)) return 'other';
  if (error.status === 401 || error.code === 'unauthorized') return 'expired';
  if (error.code === 'validation_failed') return 'malformed';
  return 'other';
}
