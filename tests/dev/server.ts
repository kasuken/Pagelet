// Local development server: the real API handlers, a seeded embedded PostgreSQL, and two local stand-ins.
//   - Mail: printed to this console (sign-in links appear here). Never used in hosted production (the API refuses it).
//   - Storage: placeholder URLs. Playback and downloads fail visibly, as they would without real files.
//   - Owner: requests under /api/owner/* get a local owner identity header. Owner checks still run in the API.
// Stripe checkout is not available locally.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { migrate } from '@pagelet/db/migrate.mjs';
import { routes } from '../../api/src/functions/routes.js';
import { paymentRoutes } from '../../api/src/functions/payments.js';
import { ownerRoutes, accountRoutes } from '../../api/src/functions/owner.js';
import { storefrontRoutes } from '../../api/src/functions/storefront.js';
import { learningRoutes } from '../../api/src/functions/learning.js';
import { catalogRoutes } from '../../api/src/functions/catalog.js';
import { setDepsForTesting } from '../../api/src/core/deps.js';
import { loadConfig } from '../../api/src/core/config.js';
import { createLogMail } from '../../api/src/services/mail.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dataDir = join(root, '.dev-data');
const PG_PORT = 5433;
const API_PORT = 7071;
const APP_ORIGIN = 'http://localhost:5173';
const OWNER_USER_ID = 'dev-owner';

const table = { ...routes, ...paymentRoutes, ...ownerRoutes, ...accountRoutes, ...storefrontRoutes, ...learningRoutes, ...catalogRoutes } as unknown as Record<
  string,
  { methods: string[]; route: string; handler: (req: any, inv: any) => Promise<any> }
>;

// Specific routes first; the catch-all `{*rest}` last.
const compiled = Object.entries(table)
  .map(([name, def]) => ({ name, def, segments: def.route.split('/') }))
  .sort((a, b) => Number(a.segments.some((s) => s.startsWith('{*'))) - Number(b.segments.some((s) => s.startsWith('{*'))));

function match(method: string, path: string): { def: (typeof compiled)[number]['def']; params: Record<string, string> } | null {
  const parts = path.split('/').filter((p) => p.length > 0);
  for (const { def, segments } of compiled) {
    if (!def.methods.includes(method)) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.startsWith('{*')) {
        params[seg.slice(2, -1)] = parts.slice(i).map(decodeURIComponent).join('/');
        return { def, params };
      }
      if (i >= parts.length) { ok = false; break; }
      if (seg.startsWith('{')) params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
      else if (seg !== parts[i]) { ok = false; break; }
    }
    if (ok && parts.length === segments.length) return { def, params };
  }
  return null;
}

async function startPostgres(): Promise<pg.Pool> {
  await mkdir(dataDir, { recursive: true });
  const fresh = !(await readFile(join(dataDir, 'pg', 'PG_VERSION')).then(() => true, () => false));
  // Reuse a PostgreSQL left running by an earlier session; it is persistent by design.
  const probe = new pg.Client({ connectionString: `postgres://postgres:dev-only-password@127.0.0.1:${PG_PORT}/postgres`, connectionTimeoutMillis: 1500 });
  const alreadyRunning = await probe.connect().then(() => probe.end().then(() => true), () => false);
  const server = new EmbeddedPostgres({
    databaseDir: join(dataDir, 'pg'),
    user: 'postgres',
    password: 'dev-only-password',
    port: PG_PORT,
    persistent: true,
    onLog: () => undefined,
    onError: () => undefined,
  });
  if (!alreadyRunning) {
    if (fresh) await server.initialise();
    await server.start();
  }
  const admin = new pg.Client({ connectionString: `postgres://postgres:dev-only-password@127.0.0.1:${PG_PORT}/postgres` });
  await admin.connect();
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = 'pagelet_dev'`);
  if (exists.rowCount === 0) await admin.query('CREATE DATABASE pagelet_dev');
  await admin.end();
  const url = `postgres://postgres:dev-only-password@127.0.0.1:${PG_PORT}/pagelet_dev`;
  await migrate(url, join(root, 'db', 'migrations'));
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM products');
  if (rows[0].n === 0) {
    await pool.query(await readFile(join(root, 'db', 'seed', 'dev.sql'), 'utf8'));
    console.log('Loaded demo data (buyer@example.test owns the course; newcomer@example.test owns nothing).');
  }
  return pool;
}

function ownerHeader(): string {
  return Buffer.from(JSON.stringify({ identityProvider: 'github', userId: OWNER_USER_ID, userDetails: 'dev owner', userRoles: ['authenticated'] })).toString('base64');
}

async function toRequest(req: IncomingMessage, url: URL, method: string): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  if (url.pathname.startsWith('/api/owner/') && !headers.has('x-ms-client-principal')) headers.set('x-ms-client-principal', ownerHeader());
  const request = new Request(url.toString(), { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body });
  return Object.assign(request, { query: url.searchParams, params: {} });
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body?: string, cookies: any[] = []) {
  const setCookie = cookies.map((c) => {
    const parts = [`${c.name}=${c.value}`, `Path=${c.path ?? '/'}`, 'HttpOnly', 'Secure', 'SameSite=Lax'];
    if (c.maxAge !== undefined) parts.push(`Max-Age=${c.maxAge}`);
    if (c.expires) parts.push(`Expires=${new Date(c.expires).toUTCString()}`);
    return parts.join('; ');
  });
  res.writeHead(status, { ...headers, ...(setCookie.length ? { 'Set-Cookie': setCookie } : {}), 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Credentials': 'true' });
  res.end(body);
}

async function main() {
  const pool = await startPostgres();
  const config = loadConfig({
    APP_BASE_URL: APP_ORIGIN,
    DATABASE_URL: `postgres://postgres:dev-only-password@127.0.0.1:${PG_PORT}/pagelet_dev`,
    OWNER_IDENTITY_PROVIDER: 'github',
    OWNER_USER_ID,
    MAIL_TRANSPORT: 'log',
    PUBLISH_TOKEN: 'dev-only-publish-token',
  } as NodeJS.ProcessEnv);
  const storage = {
    async issueUploadUrl(key: string) { return `http://localhost:${API_PORT}/dev-blob/upload/${encodeURIComponent(key)}`; },
    async issueReadUrl(key: string, seconds: number) { return `http://localhost:${API_PORT}/dev-blob/${encodeURIComponent(key)}?expires_in=${seconds}`; },
    async inspect() { return null; },
    async readHead() { return Buffer.alloc(0); },
    async delete() { return undefined; },
  };
  setDepsForTesting({ config, db: () => pool, mail: createLogMail(), blob: () => storage as any });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${API_PORT}`);
    if (req.method === 'OPTIONS') return send(res, 204, { 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE', 'Access-Control-Allow-Headers': 'content-type,idempotency-key' });
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: { code: 'not_found', message: 'Not an API path.' } }));
    const path = url.pathname.slice('/api'.length);
    const method = req.method ?? 'GET';
    const hit = match(method, path);
    if (!hit) return send(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: { code: 'not_found', message: 'No API endpoint matches this path.' } }));
    const request = await toRequest(req, url, method);
    request.params = hit.params;
    const invocation = { invocationId: 'dev', functionName: hit.def.route, extraInputs: { get: () => undefined } };
    try {
      const r = await hit.def.handler(request, invocation);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.headers ?? {})) headers[k] = String(v);
      send(res, r.status ?? 200, headers, r.body === undefined ? undefined : String(r.body), r.cookies ?? []);
    } catch (error) {
      console.error('unexpected', error);
      send(res, 500, { 'Content-Type': 'application/json' }, JSON.stringify({ error: { code: 'internal_error', message: 'Local server error. See the console.' } }));
    }
  });
  server.listen(API_PORT, () => {
    console.log(`Local API on http://localhost:${API_PORT} (owner identity injected for /api/owner/* only). Run the web app with: pnpm --filter @pagelet/web run dev`);
  });
}

main().catch((error: unknown) => {
  console.error('Local server failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
