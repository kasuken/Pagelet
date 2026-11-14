import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { startPostgres, type TestDatabase } from '../helpers/postgres.js';
import { APP_ORIGIN, bodyOf, cookieFrom, invocation, makeRequest, principalHeader } from '../helpers/api.js';
import type { MailMessage, MailPort } from '../../api/src/core/ports.js';

let server: TestDatabase;
let db: pg.Pool;
let dbUrl = '';
let sent: MailMessage[] = [];
let mailMode: 'ok' | 'fail' = 'ok';
let routes: Record<string, { handler: (r: any, i: any) => Promise<any> }>;
let setDepsForTesting: (partial: Record<string, unknown> | undefined) => void;
let loadConfig: (env: NodeJS.ProcessEnv) => any;

const fakeMail: MailPort = {
  async send(message) {
    if (mailMode === 'fail') throw new Error('provider unavailable');
    sent.push(message);
    return { providerMessageId: `msg_${sent.length}` };
  },
};

function tokenFromLastMail(): string {
  const link = sent.at(-1)!.text.split('\n').find((l) => l.includes('/account/confirm'))!;
  return new URL(link).searchParams.get('token')!;
}

function configFor(env: Record<string, string | undefined>) {
  return loadConfig({ APP_BASE_URL: APP_ORIGIN, OWNER_IDENTITY_PROVIDER: 'github', OWNER_USER_ID: '4242', DATABASE_URL: dbUrl, ...env } as NodeJS.ProcessEnv);
}

beforeAll(async () => {
  server = await startPostgres(54_403);
  const url = await server.createMigrated('api_auth');
  dbUrl = url;
  db = new pg.Pool({ connectionString: url, max: 2 });
  // Import after the environment is set up; deps are created lazily.
  const routesModule = await import('../../api/src/functions/routes.js');
  routes = routesModule.routes as typeof routes;
  const depsModule = await import('../../api/src/core/deps.js');
  setDepsForTesting = depsModule.setDepsForTesting as typeof setDepsForTesting;
  loadConfig = (await import('../../api/src/core/config.js')).loadConfig;
  setDepsForTesting({ config: configFor({}), db: () => db, mail: fakeMail });
}, 180_000);

afterAll(async () => {
  setDepsForTesting?.(undefined);
  await db?.end();
  await server?.stop();
});

beforeEach(async () => {
  sent = [];
  mailMode = 'ok';
  setDepsForTesting({ config: configFor({}), db: () => db, mail: fakeMail });
  await db.query('TRUNCATE sessions, login_tokens, customers, rate_limits, email_outbox, audit_events RESTART IDENTITY CASCADE');
});

const call = (name: string, request: any) => routes[name].handler(request, invocation);

describe('sign-in links (A02)', () => {
  it('answers identically for known and unknown addresses and never stores or logs the raw token', async () => {
    await db.query(`INSERT INTO customers (id, email_normalized) VALUES (gen_random_uuid(), 'known@example.test')`);
    const known = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'known@example.test' } }));
    const unknown = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'nobody@example.test' } }));
    expect(known.status).toBe(202);
    expect(bodyOf(known)).toEqual(bodyOf(unknown));
    expect(known.headers['Cache-Control']).toBe('no-store');

    const token = tokenFromLastMail();
    const stored = await db.query('SELECT token_hash, email_normalized FROM login_tokens');
    expect(stored.rowCount).toBe(2);
    for (const row of stored.rows) expect(row.token_hash.toString('base64url')).not.toContain(token);
    const everything = JSON.stringify((await db.query('SELECT * FROM email_outbox')).rows) + JSON.stringify((await db.query('SELECT * FROM audit_events')).rows);
    expect(everything).not.toContain(token);
  });

  it('rejects a cross-origin mutation and a missing Origin header', async () => {
    const wrong = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'a@example.test' }, origin: 'https://evil.test' }));
    expect(wrong.status).toBe(403);
    expect(bodyOf(wrong).error.code).toBe('origin_rejected');
    const missing = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'a@example.test' }, origin: null }));
    expect(missing.status).toBe(403);
  });

  it('returns validation issues with paths, and refuses non-JSON and oversized bodies', async () => {
    const bad = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'not-an-email' } }));
    expect(bad.status).toBe(400);
    expect(bodyOf(bad).error.issues[0].path).toBe('email');
    expect(bodyOf(bad).error.requestId).toMatch(/^[0-9a-f-]{36}$/);

    const form = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { raw: 'email=a', contentType: 'text/plain' }));
    expect(form.status).toBe(415);

    const huge = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { raw: 'x'.repeat(20 * 1024), contentType: 'application/json' }));
    expect(huge.status).toBe(413);
  });

  it('rate-limits by normalized address and returns Retry-After', async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'Burst@Example.test ' } }));
      expect(ok.status).toBe(202);
    }
    const blocked = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'burst@example.test' } }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('keeps the outbox consistent when delivery fails, without losing the login record', async () => {
    mailMode = 'fail';
    const response = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'fail@example.test' } }));
    expect(response.status).toBe(202);
    const outbox = await db.query(`SELECT status, attempts, last_error FROM email_outbox`);
    expect(outbox.rows[0]).toMatchObject({ status: 'failed', attempts: 1 });
    expect(outbox.rows[0].last_error).toContain('provider unavailable');
  });

  it('removes the login record when the transaction fails after the token insert', async () => {
    // Fail the outbox insert inside the same transaction as the token insert.
    await db.query(`CREATE OR REPLACE FUNCTION fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
                    BEGIN RAISE EXCEPTION 'simulated outage'; END $$`);
    await db.query(`CREATE TRIGGER fail_outbox_insert BEFORE INSERT ON email_outbox FOR EACH ROW EXECUTE FUNCTION fail_outbox()`);
    try {
      const response = await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'rollback@example.test' } }));
      expect(response.status).toBe(500);
      expect(bodyOf(response).error.code).toBe('internal_error');
    } finally {
      await db.query('DROP TRIGGER IF EXISTS fail_outbox_insert ON email_outbox');
    }
    const tokens = await db.query(`SELECT count(*)::int AS n FROM login_tokens`);
    expect(tokens.rows[0].n).toBe(0);
  });
});

describe('sessions (A02)', () => {
  it('consumes a token exactly once, sets Secure HttpOnly SameSite cookies, and rejects replay', async () => {
    await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'buyer@example.test', returnTo: '/library' } }));
    const token = tokenFromLastMail();
    const first = await call('auth-sessions', makeRequest('POST', 'auth/sessions', { json: { token } }));
    expect(first.status).toBe(200);
    expect(bodyOf(first).returnTo).toBe('/library');
    const cookieHeader = (first.cookies as any[])[0];
    expect(cookieHeader).toMatchObject({ name: '__Host-pagelet_session', httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    const replay = await call('auth-sessions', makeRequest('POST', 'auth/sessions', { json: { token } }));
    expect(replay.status).toBe(401);
  });

  it('refuses an expired token', async () => {
    await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'late@example.test' } }));
    const token = tokenFromLastMail();
    await db.query(`UPDATE login_tokens SET expires_at = now() - interval '1 minute'`);
    const response = await call('auth-sessions', makeRequest('POST', 'auth/sessions', { json: { token } }));
    expect(response.status).toBe(401);
  });

  it('never consumes a token on GET (scanner-safe) and returns JSON 404 for unknown API paths', async () => {
    await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'scanner@example.test' } }));
    const token = tokenFromLastMail();
    const scan = await routes['api-not-found'].handler(makeRequest('GET', `auth/sessions?token=${token}`), invocation);
    expect(scan.status).toBe(404);
    expect(String(scan.headers['Content-Type'])).toContain('application/json');
    expect(String(scan.body)).not.toContain('<html');
    const row = await db.query(`SELECT consumed_at FROM login_tokens`);
    expect(row.rows[0].consumed_at).toBeNull();
  });

  it('rotates the session on login and revokes the presented old session', async () => {
    await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'rotate@example.test' } }));
    const first = await call('auth-sessions', makeRequest('POST', 'auth/sessions', { json: { token: tokenFromLastMail() } }));
    const oldSession = cookieFrom(first, '__Host-pagelet_session')!;
    await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email: 'rotate@example.test' } }));
    await call('auth-sessions', makeRequest('POST', 'auth/sessions', {
      json: { token: tokenFromLastMail() },
      headers: { cookie: `__Host-pagelet_session=${oldSession}` },
    }));
    const me = await call('me', makeRequest('GET', 'me', { headers: { cookie: `__Host-pagelet_session=${oldSession}` } }));
    expect(me.status).toBe(401);
  });

  it('returns a masked address on /api/me with no-store caching, and logout revokes the session', async () => {
    const login = await call('auth-sessions', makeRequest('POST', 'auth/sessions', { json: { token: await issueToken('mask.me@example.test') } }));
    const session = cookieFrom(login, '__Host-pagelet_session')!;
    const me = await call('me', makeRequest('GET', 'me', { headers: { cookie: `__Host-pagelet_session=${session}` } }));
    expect(me.status).toBe(200);
    expect(bodyOf(me).customer.maskedEmail).toBe('m***@example.test');
    expect(me.headers['Cache-Control']).toBe('private, no-store');
    expect(String(me.body)).not.toContain('mask.me@example.test');

    const out = await call('auth-logout', makeRequest('POST', 'auth/logout', { headers: { cookie: `__Host-pagelet_session=${session}` } }));
    expect(out.status).toBe(204);
    const after = await call('me', makeRequest('GET', 'me', { headers: { cookie: `__Host-pagelet_session=${session}` } }));
    expect(after.status).toBe(401);
  });

  it('stores only hashes for session identifiers', async () => {
    const login = await call('auth-sessions', makeRequest('POST', 'auth/sessions', { json: { token: await issueToken('hash@example.test') } }));
    const session = cookieFrom(login, '__Host-pagelet_session')!;
    const rows = await db.query('SELECT id_hash FROM sessions');
    expect(rows.rows[0].id_hash.equals(createHash('sha256').update(session).digest())).toBe(true);
    expect(JSON.stringify(rows.rows)).not.toContain(session);
  });
});

async function issueToken(email: string): Promise<string> {
  await call('auth-login-links', makeRequest('POST', 'auth/login-links', { json: { email } }));
  return tokenFromLastMail();
}

describe('owner identity (A01)', () => {
  const ownerCall = (headers: Record<string, string> = {}) => call('owner-me', makeRequest('GET', 'owner/me', { headers }));

  it('fails closed when the owner is not configured', async () => {
    setDepsForTesting({ config: configFor({ OWNER_USER_ID: undefined }), db: () => db, mail: fakeMail });
    const response = await ownerCall({ 'x-ms-client-principal': principalHeader('github', '4242') });
    expect(response.status).toBe(503);
  });

  it('denies anonymous, wrong-provider, wrong-ID and lookalike identities; allows only the exact owner', async () => {
    expect((await ownerCall()).status).toBe(401);
    expect((await ownerCall({ 'x-ms-client-principal': principalHeader('github', '4242') })).status).toBe(200);
    expect((await ownerCall({ 'x-ms-client-principal': principalHeader('aad', '4242') })).status).toBe(403);
    expect((await ownerCall({ 'x-ms-client-principal': principalHeader('github', '4243') })).status).toBe(403);
    expect((await ownerCall({ 'x-ms-client-principal': principalHeader('github', '42') })).status).toBe(403);
    expect((await ownerCall({ 'x-ms-client-principal': 'not-base64-json' })).status).toBe(401);
  });

  it('a customer session never implies owner privileges', async () => {
    const login = await call('auth-sessions', makeRequest('POST', 'auth/sessions', { json: { token: await issueToken('customer@example.test') } }));
    const session = cookieFrom(login, '__Host-pagelet_session')!;
    const response = await ownerCall({ cookie: `__Host-pagelet_session=${session}` });
    expect(response.status).toBe(401);
  });
});

describe('health (F04)', () => {
  it('reports database reachability without secrets', async () => {
    const response = await call('health', makeRequest('GET', 'health'));
    expect(bodyOf(response)).toMatchObject({ status: 'ok', database: 'ok' });
    expect(JSON.stringify(bodyOf(response))).not.toMatch(/postgres:\/\//);
  });
});

