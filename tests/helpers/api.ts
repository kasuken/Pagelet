import type { HttpRequest, HttpResponseInit } from '@azure/functions';

export const APP_ORIGIN = 'https://shop.test';

export interface CallOptions {
  headers?: Record<string, string>;
  json?: unknown;
  raw?: string;
  contentType?: string;
  origin?: string | null;
  params?: Record<string, string>;
}

/** Builds an HttpRequest-shaped object from the WHATWG Request that the handlers rely on. */
export function makeRequest(method: string, path: string, options: CallOptions = {}): HttpRequest {
  const url = `${APP_ORIGIN}/api/${path}`;
  const headers = new Headers(options.headers ?? {});
  if (options.origin !== null) headers.set('origin', options.origin ?? APP_ORIGIN);
  let body: string | undefined;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers.set('content-type', options.contentType ?? 'application/json');
  } else if (options.raw !== undefined) {
    body = options.raw;
    headers.set('content-type', options.contentType ?? 'application/json');
  }
  const request = new Request(url, { method, headers, body: method === 'GET' ? undefined : body });
  return Object.assign(request, { query: new URL(url).searchParams, params: options.params ?? {} }) as unknown as HttpRequest;
}

export const invocation = { invocationId: 'test-invocation', functionName: 'test', extraInputs: { get: () => undefined } };

export function cookieFrom(response: HttpResponseInit, name: string): string | null {
  const cookies = (response.cookies ?? []) as Array<{ name: string; value: string }>;
  return cookies.find((c) => c.name === name)?.value ?? null;
}

export function bodyOf<T = any>(response: HttpResponseInit): T {
  return JSON.parse(String(response.body ?? 'null')) as T;
}

export function principalHeader(provider: string, userId: string): string {
  return Buffer.from(JSON.stringify({ identityProvider: provider, userId, userDetails: 'owner', userRoles: ['authenticated'] })).toString('base64');
}
