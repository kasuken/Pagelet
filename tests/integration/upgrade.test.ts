import { mkdtemp, copyFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrate } from '@pagelet/db/migrate.mjs';
import { startPostgres, type TestDatabase } from '../helpers/postgres.js';

const MIGRATIONS = new URL('../../db/migrations/', import.meta.url).pathname;
let server: TestDatabase;
let work: string;

beforeAll(async () => {
  server = await startPostgres(54_402);
  work = await mkdtemp(join(tmpdir(), 'pagelet-upgrade-'));
}, 120_000);

afterAll(async () => {
  await server?.stop();
  if (work) await rm(work, { recursive: true, force: true });
});

describe('upgrade from an earlier schema (real PostgreSQL)', () => {
  it('keeps data and constraints when versions 2 through 5 are applied to a version 1 installation', async () => {
    // Build an "earlier installation": only version 1 is present.
    const v1Only = join(work, 'v1');
    await mkdir(v1Only, { recursive: true });
    await copyFile(join(MIGRATIONS, '0001_core_schema.sql'), join(v1Only, '0001_core_schema.sql'));

    const admin = new pg.Client({ connectionString: `${server.url}/postgres` });
    await admin.connect();
    await admin.query('CREATE DATABASE upgrade_v1');
    await admin.end();
    const url = `${server.url}/upgrade_v1`;

    expect(await migrate(url, v1Only)).toEqual([1]);

    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      await c.query(`INSERT INTO customers (id, email_normalized) VALUES ('00000000-0000-4000-9000-000000000e01','keep@example.test')`);
      await c.query(`INSERT INTO products (id, slug, product_type, status, title, price_minor)
                     VALUES ('00000000-0000-4000-8000-000000000e02','kept-product','download','published','Kept',500)`);

      // Upgrade with the full migration directory.
      expect(await migrate(url, MIGRATIONS)).toEqual([2, 3, 4, 5]);

      const kept = await c.query('SELECT email_normalized FROM customers WHERE email_normalized = $1', ['keep@example.test']);
      expect(kept.rowCount).toBe(1);
      const index = await c.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'orders_customer_created_idx'`);
      expect(index.rowCount).toBe(1);
      const claims = await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'free_claim_tokens'`);
      expect(claims.rowCount).toBe(1);
      await expect(
        c.query(`INSERT INTO products (id, slug, product_type, title) VALUES (gen_random_uuid(),'kept-product','course','Dup')`),
      ).rejects.toMatchObject({ code: '23505' });
    } finally {
      await c.end();
    }
  });
});
