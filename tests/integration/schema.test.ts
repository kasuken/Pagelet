import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { migrate } from '@pagelet/db/migrate.mjs';
import { startPostgres, type TestDatabase } from '../helpers/postgres.js';

let server: TestDatabase;

beforeAll(async () => {
  server = await startPostgres(54_401);
}, 120_000);

afterAll(async () => {
  await server?.stop();
});

const open: pg.Client[] = [];

async function client(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  open.push(c);
  return c;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.end().catch(() => undefined)));
});

describe('core schema invariants (real PostgreSQL)', () => {
  it('applies migrations once and is idempotent on rerun', async () => {
    const url = await server.createMigrated('schema_idem');
    expect(await migrate(url)).toEqual([]);
  });

  it('rejects a second shop_settings row and a non-integer price', async () => {
    const url = await server.createMigrated('schema_singleton');
    const c = await client(url);
    await c.query(`INSERT INTO shop_settings (id, currency) VALUES (1, 'EUR')`);
    await expect(c.query(`INSERT INTO shop_settings (id, currency) VALUES (2, 'EUR')`)).rejects.toMatchObject({ code: '23514' });
    await expect(
      c.query(`INSERT INTO products (id, slug, product_type, title, price_minor) VALUES (gen_random_uuid(), 'bad-price', 'course', 'X', -1)`),
    ).rejects.toMatchObject({ code: '23514' });
    await c.end();
  });

  it('enforces unique provider payment IDs and one purchase grant per order and product', async () => {
    const url = await server.createMigrated('schema_unique');
    const c = await client(url);
    await c.query(`INSERT INTO products (id, slug, product_type, status, title, price_minor)
                   VALUES ('00000000-0000-4000-8000-0000000000a1','p-one','course','published','P',100)`);
    await c.query(`INSERT INTO customers (id, email_normalized) VALUES ('00000000-0000-4000-9000-0000000000c1','a@example.test')`);
    await c.query(`INSERT INTO product_versions (id, product_id, version_no, snapshot)
                   VALUES ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000a1',1,'{}')`);
    await c.query(`INSERT INTO checkout_attempts (id, product_id, product_version_id, email_normalized, idempotency_key, amount_minor, currency, expires_at)
                   VALUES ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1','a@example.test','k1',100,'EUR', now() + interval '1 day')`);
    await c.query(`INSERT INTO orders (id, customer_id, checkout_attempt_id, provider_payment_id, amount_minor, currency, policy_version)
                   VALUES ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-9000-0000000000c1','00000000-0000-4000-8000-0000000000d1','pi_1',100,'EUR',1)`);
    await expect(
      c.query(`INSERT INTO orders (id, customer_id, checkout_attempt_id, provider_payment_id, amount_minor, currency, policy_version)
               VALUES (gen_random_uuid(),'00000000-0000-4000-9000-0000000000c1','00000000-0000-4000-8000-0000000000d1','pi_2',100,'EUR',1)`),
    ).rejects.toMatchObject({ code: '23505' });
    await c.query(`INSERT INTO entitlement_grants (id, customer_id, product_id, source, order_id)
                   VALUES (gen_random_uuid(),'00000000-0000-4000-9000-0000000000c1','00000000-0000-4000-8000-0000000000a1','purchase','00000000-0000-4000-8000-0000000000e1')`);
    await expect(
      c.query(`INSERT INTO entitlement_grants (id, customer_id, product_id, source, order_id)
               VALUES (gen_random_uuid(),'00000000-0000-4000-9000-0000000000c1','00000000-0000-4000-8000-0000000000a1','purchase','00000000-0000-4000-8000-0000000000e1')`),
    ).rejects.toMatchObject({ code: '23505' });
    await c.end();
  });

  it('refuses a lesson resource that belongs to another product (composite foreign key)', async () => {
    const url = await server.createMigrated('schema_cross_product');
    const c = await client(url);
    const P1 = '00000000-0000-4000-8000-0000000000f1';
    const P2 = '00000000-0000-4000-8000-0000000000f2';
    for (const [id, slug] of [[P1, 'prod-a'], [P2, 'prod-b']]) {
      await c.query(`INSERT INTO products (id, slug, product_type, status, title) VALUES ($1,$2,'course','published','T')`, [id, slug]);
    }
    await c.query(`INSERT INTO assets (id, product_id, kind, object_key, mime_type, declared_bytes)
                   VALUES ('00000000-0000-4000-8000-0000000000a9', $1, 'file', 'k/b.pdf', 'application/pdf', 10)`, [P2]);
    await c.query(`INSERT INTO sections (id, product_id, position, title) VALUES ('00000000-0000-4000-8000-000000000051',$1,0,'S')`, [P1]);
    await c.query(`INSERT INTO lessons (id, section_id, product_id, position, kind, title)
                   VALUES ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000051',$1,0,'text','L')`, [P1]);
    await expect(
      c.query(`INSERT INTO lesson_resources (lesson_id, product_id, asset_id, position)
               VALUES ('00000000-0000-4000-8000-000000000061',$1,'00000000-0000-4000-8000-0000000000a9',0)`, [P1]),
    ).rejects.toMatchObject({ code: '23503' });
    await c.end();
  });

  it('refuses an edited, already-applied migration (checksum mismatch)', async () => {
    const url = await server.createMigrated('schema_checksum');
    const c = await client(url);
    await c.query(`UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1`);
    await c.end();
    await expect(migrate(url)).rejects.toThrow(/checksum mismatch/);
  });
});
