import type { ApiErrorBody, ErrorCode } from '@pagelet/contracts';

/** Client-only codes for failures that never reached a JSON API response. */
export type ClientErrorCode = 'network_error' | 'invalid_response';

export type ApiFailureCode = ErrorCode | ClientErrorCode;

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiFailureCode;
  readonly requestId: string;
  readonly issues: readonly ApiIssue[];

  constructor(init: {
    status: number;
    code: ApiFailureCode;
    message: string;
    requestId: string;
    issues?: readonly ApiIssue[];
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.issues = init.issues ?? [];
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Extra request headers, for example Idempotency-Key. Cannot override Accept or X-Request-Id. */
  headers?: Record<string, string>;
  /** Lets a request finish after the page is hidden or closed (progress saves). */
  keepalive?: boolean;
}

const FALLBACK_MESSAGES: Record<ApiFailureCode, string> = {
  validation_failed: 'Some details need attention.',
  not_found: 'We could not find that.',
  unauthorized: 'Sign in to continue.',
  forbidden: 'This account does not have access.',
  origin_rejected: 'This request came from an unexpected address. Reload the page and try again.',
  conflict: 'This changed somewhere else. Reload and try again.',
  rate_limited: 'Too many attempts. Wait a minute, then try again.',
  payload_too_large: 'That request is too large.',
  unsupported_media_type: 'That request format is not supported.',
  method_not_allowed: 'That action is not available here.',
  service_unavailable: 'The service is not available right now. Try again shortly.',
  internal_error: 'Something went wrong on our side. Try again shortly.',
  network_error: 'We could not reach the server. Check your connection and try again.',
  invalid_response: 'The server sent an unexpected response. Try again shortly.',
};

const KNOWN_CODES = new Set<string>(Object.keys(FALLBACK_MESSAGES));
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function codeForStatus(status: number): ApiFailureCode {
  if (status === 400) return 'validation_failed';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 405) return 'method_not_allowed';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 415) return 'unsupported_media_type';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'service_unavailable';
  if (status >= 500) return 'internal_error';
  return 'invalid_response';
}

function isErrorEnvelope(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

/** Builds an ApiError from a non-2xx response, whatever its body looks like. */
export async function toApiError(response: Response, sentRequestId: string): Promise<ApiError> {
  const headerId = response.headers.get('X-Request-Id');
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (isErrorEnvelope(body)) {
    const { code, message, requestId, issues } = body.error;
    const knownCode = KNOWN_CODES.has(code) ? (code as ApiFailureCode) : codeForStatus(response.status);
    return new ApiError({
      status: response.status,
      code: knownCode,
      message: message || FALLBACK_MESSAGES[knownCode],
      requestId: pickRequestId(requestId, headerId, sentRequestId),
      issues: Array.isArray(issues) ? issues : [],
    });
  }

  const code = codeForStatus(response.status);
  return new ApiError({
    status: response.status,
    code,
    message: FALLBACK_MESSAGES[code],
    requestId: pickRequestId(undefined, headerId, sentRequestId),
  });
}

function pickRequestId(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (candidate && REQUEST_ID_PATTERN.test(candidate)) return candidate;
  }
  return candidates.find((c): c is string => Boolean(c)) ?? 'unavailable';
}

/**
 * The single fetch helper for the Pagelet API. Sends JSON, always sends an X-Request-Id
 * so failures can be quoted to support, and throws ApiError for every failure.
 * It never logs request bodies, tokens or email addresses.
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const requestId = newRequestId();
  const headers: Record<string, string> = {
    ...options.headers,
    Accept: 'application/json',
    'X-Request-Id': requestId,
  };
  const init: RequestInit = {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers,
    signal: options.signal,
    keepalive: options.keepalive,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: 'network_error',
      message: FALLBACK_MESSAGES.network_error,
      requestId,
    });
  }

  if (!response.ok) {
    throw await toApiError(response, requestId);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError({
      status: response.status,
      code: 'invalid_response',
      message: FALLBACK_MESSAGES.invalid_response,
      requestId: pickRequestId(response.headers.get('X-Request-Id'), requestId),
    });
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** User-visible text for any thrown value, always ending with a reference users can quote. */
export function describeError(error: unknown): { message: string; requestId: string } {
  if (isApiError(error)) return { message: error.message, requestId: error.requestId };
  return { message: FALLBACK_MESSAGES.internal_error, requestId: 'unavailable' };
}
