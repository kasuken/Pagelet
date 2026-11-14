import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, describeError } from './api';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('api()', () => {
  it('sends JSON with Accept, Content-Type, same-origin credentials and a request id', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(202, { status: 'accepted' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api<{ status: string }>('/api/auth/login-links', { method: 'POST', body: { email: 'a@b.co' } });

    expect(result).toEqual({ status: 'accepted' });
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBe(JSON.stringify({ email: 'a@b.co' }));
    expect(headers.Accept).toBe('application/json');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Request-Id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('maps the error envelope, keeping the server request id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(429, { error: { code: 'rate_limited', message: 'Slow down.', requestId: 'srv-12345678' } }),
    ));

    const error = await api('/api/library').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', message: 'Slow down.', requestId: 'srv-12345678' });
    expect(describeError(error)).toEqual({ message: 'Slow down.', requestId: 'srv-12345678' });
  });

  it('keeps validation issues', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(400, {
        error: { code: 'validation_failed', message: 'Invalid.', requestId: 'srv-abcdefgh', issues: [{ path: 'email', message: 'Bad' }] },
      }),
    ));
    const error = (await api('/api/x', { body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(error.issues).toEqual([{ path: 'email', message: 'Bad' }]);
  });

  it('falls back to the response header id for non-JSON failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<html>Bad gateway</html>', { status: 502, headers: { 'X-Request-Id': 'hdr-87654321' } }),
    ));
    const error = (await api('/api/library').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('internal_error');
    expect(error.requestId).toBe('hdr-87654321');
    expect(error.message).toMatch(/try again/i);
  });

  it('uses its own request id when the network fails', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    const error = (await api('/api/library').catch((e: unknown) => e)) as ApiError;
    const sent = (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)['X-Request-Id'];
    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
    expect(error.requestId).toBe(sent);
  });

  it('maps 503 without a body to service_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    const error = (await api('/api/owner/me').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('service_unavailable');
    expect(error.requestId).not.toBe('');
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api('/api/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('never writes to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: { code: 'unauthorized', message: 'No', requestId: 'r-12345678' } })));
    await api('/api/auth/sessions', { body: { token: 'x'.repeat(48) } }).catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
