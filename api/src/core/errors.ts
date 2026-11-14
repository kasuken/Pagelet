import type { ErrorCode } from '@pagelet/contracts';

export type Issue = { path: string; message: string };

/** Errors that map directly to the public error envelope. Anything else becomes internal_error. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly issues?: Issue[],
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiErrors = {
  validation: (issues: Issue[]) => new ApiError(400, 'validation_failed', 'The request is not valid.', issues),
  unauthorized: (message = 'Sign in is required.') => new ApiError(401, 'unauthorized', message),
  forbidden: (message = 'You do not have access to this resource.') => new ApiError(403, 'forbidden', message),
  notFound: (message = 'Not found.') => new ApiError(404, 'not_found', message),
  conflict: (message: string, issues?: Issue[]) => new ApiError(409, 'conflict', message, issues),
  payloadTooLarge: (limit: number) =>
    new ApiError(413, 'payload_too_large', `The request body must be at most ${limit} bytes.`),
  unsupportedMedia: () => new ApiError(415, 'unsupported_media_type', 'Send application/json.'),
  methodNotAllowed: () => new ApiError(405, 'method_not_allowed', 'This method is not allowed.'),
  originRejected: () => new ApiError(403, 'origin_rejected', 'This request came from an unexpected origin.'),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, 'rate_limited', 'Too many requests. Try again later.', undefined, {
      'Retry-After': String(retryAfterSeconds),
    }),
  unavailable: (message: string) => new ApiError(503, 'service_unavailable', message),
};
