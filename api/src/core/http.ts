import { randomUUID } from 'node:crypto';
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { z } from 'zod';
import { ApiError, apiErrors, type Issue } from './errors.js';
import type { AppConfig } from './config.js';
import { createLogger, redactUrl, type Logger } from './logger.js';

export const DEFAULT_JSON_LIMIT = 16 * 1024;
export const WEBHOOK_LIMIT = 512 * 1024;
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

export type CachePolicy = 'private' | 'public' | 'none';

export interface Result {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  cookies?: NonNullable<HttpResponseInit['cookies']>;
  cache?: CachePolicy;
  /** Set for public responses so shared caches may hold them briefly. */
  publicMaxAgeSeconds?: number;
}

export interface Ctx {
  requestId: string;
  request: HttpRequest;
  invocation: InvocationContext;
  log: Logger;
  config: AppConfig;
}

export type Handler = (ctx: Ctx) => Promise<Result>;

export function cacheHeaders(policy: CachePolicy, publicMaxAgeSeconds = 60): Record<string, string> {
  if (policy === 'private') return { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  if (policy === 'public') {
    return { 'Cache-Control': `public, max-age=${publicMaxAgeSeconds}, s-maxage=${publicMaxAgeSeconds * 5}`, Vary: 'Accept-Encoding' };
  }
  return { 'Cache-Control': 'no-store' };
}

function requestIdFrom(request: HttpRequest): string {
  const inbound = request.headers.get('x-request-id');
  return inbound && REQUEST_ID.test(inbound) ? inbound : randomUUID();
}

/** Wraps a handler: request IDs, JSON envelopes, error mapping, cache policy and redacted logs. */
export function apiHandler(config: () => AppConfig, handler: Handler, base: { route: string }) {
  return async (request: HttpRequest, invocation: InvocationContext): Promise<HttpResponseInit> => {
    const requestId = requestIdFrom(request);
    const log = createLogger(undefined, { requestId, route: base.route });
    const started = Date.now();
    let response: HttpResponseInit;
    try {
      const result = await handler({ requestId, request, invocation, log, config: config() });
      const policy = result.cache ?? 'none';
      response = {
        status: result.status ?? (result.body === undefined ? 204 : 200),
        headers: {
          ...cacheHeaders(policy, result.publicMaxAgeSeconds),
          ...(result.body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
          'X-Request-Id': requestId,
          'X-Content-Type-Options': 'nosniff',
          ...result.headers,
        },
        cookies: result.cookies,
        body: result.body === undefined ? undefined : JSON.stringify(result.body),
      };
    } catch (error) {
      response = errorResponse(error, requestId, log);
    }
    log.info('request', {
      method: request.method,
      path: redactUrl(request.url),
      status: response.status,
      durationMs: Date.now() - started,
    });
    return response;
  };
}

export function errorResponse(error: unknown, requestId: string, log: Logger): HttpResponseInit {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
        ...error.headers,
      },
      body: JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.issues ? { issues: error.issues } : {}),
        },
      }),
    };
  }
  log.error('unhandled_error', { errorName: error instanceof Error ? error.name : typeof error });
  return {
    status: 500,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
    body: JSON.stringify({
      error: { code: 'internal_error', message: 'Something went wrong. Quote the request ID when asking for help.', requestId },
    }),
  };
}

/** Reads at most `limit` bytes and throws payload_too_large without buffering the excess. */
export async function readBoundedBody(request: HttpRequest, limit: number): Promise<Buffer> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > limit) throw apiErrors.payloadTooLarge(limit);
  const stream = request.body;
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw apiErrors.payloadTooLarge(limit);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Parses a JSON body and validates it against a schema. Rejects other content types. */
export async function readJson<T extends z.ZodType>(request: HttpRequest, schema: T, limit = DEFAULT_JSON_LIMIT): Promise<z.infer<T>> {
  const type = request.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw apiErrors.unsupportedMedia();
  const raw = await readBoundedBody(request, limit);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw apiErrors.validation([{ path: '', message: 'Body must be valid JSON.' }]);
  }
  return validate(schema, parsed);
}

export function validate<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues: Issue[] = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw apiErrors.validation(issues);
  }
  return result.data;
}

/** Cookie-authenticated mutations require a same-origin Origin header. */
export function requireSameOrigin(ctx: Ctx): void {
  const origin = ctx.request.headers.get('origin');
  if (!ctx.config.appOrigin || origin !== ctx.config.appOrigin) throw apiErrors.originRejected();
}

export function queryInt(request: HttpRequest, name: string, fallback: number, max: number): number {
  const raw = request.query.get(name);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
}
