import { randomBytes } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';
import { z } from 'zod';
import type { AppConfig } from '../core/config.js';
import { apiErrors } from '../core/errors.js';

// SWA injects x-ms-client-principal for authenticated platform sessions (and the SWA CLI emulator locally).
// Only the platform sets it; the API is reachable only through SWA (verified in the F01/A01 deployment checks).
const ClientPrincipal = z.object({
  identityProvider: z.string().min(1),
  userId: z.string().min(1),
  userDetails: z.string().optional(),
  userRoles: z.array(z.string()).optional(),
});

export interface OwnerPrincipal {
  provider: string;
  userId: string;
}

export function parseClientPrincipal(header: string | null): z.infer<typeof ClientPrincipal> | null {
  if (!header) return null;
  try {
    const json = Buffer.from(header, 'base64').toString('utf8');
    const parsed = ClientPrincipal.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Exact owner check. Fails closed when the owner is not configured, when no platform identity is present,
 * and when the identity is any other provider or user. Authenticated roles alone never grant owner access.
 */
export function requireOwner(request: HttpRequest, config: AppConfig): OwnerPrincipal {
  if (!config.owner) {
    throw apiErrors.unavailable('The shop owner is not configured. Follow the owner recovery guide.');
  }
  const principal = parseClientPrincipal(request.headers.get('x-ms-client-principal'));
  if (!principal) throw apiErrors.unauthorized('Sign in as the shop owner to continue.');
  const provider = principal.identityProvider.toLowerCase();
  if (provider !== config.owner.provider || principal.userId !== config.owner.userId) {
    throw apiErrors.forbidden('This account is not the shop owner.');
  }
  return { provider, userId: principal.userId };
}

/** Random high-entropy identifier used for owner-recovery tests and audit correlation. Not an auth factor. */
export function opaqueId(): string {
  return randomBytes(16).toString('hex');
}
