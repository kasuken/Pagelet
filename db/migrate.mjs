// Versioned SQL migrations with a PostgreSQL advisory lock.
// Run by an operator or CI with the MIGRATION credential only. App requests never call this.
//   MIGRATION_DATABASE_URL=postgres://... node db/migrate.mjs [--dir db/migrations]
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const LOCK_KEY = 727_001_001; // stable application-wide advisory lock id for migrations
const here = dirname(fileURLToPath(import.meta.url));

export function checksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

export async function listMigrations(dir) {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const versions = new Set();
  return Promise.all(
    files.map(async (file) => {
      const version = Number(file.slice(0, 4));
      if (versions.has(version)) throw new Error(`Duplicate migration version ${version}`);
      versions.add(version);
      const sql = await readFile(join(dir, file), 'utf8');
      return { version, name: file, sql, checksum: checksum(sql) };
    }),
  );
}

/** Applies pending migrations. Returns the list of versions applied in this run. */
export async function migrate(connectionString, dir = join(here, 'migrations')) {
  const migrations = await listMigrations(dir);
  const client = new pg.Client({ connectionString, application_name: 'pagelet-migrate' });
  await client.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const rows = (await client.query('SELECT version, checksum FROM schema_migrations')).rows;
    const done = new Map(rows.map((r) => [r.version, r.checksum]));
    for (const m of migrations) {
      if (done.has(m.version)) {
        if (done.get(m.version) !== m.checksum) {
          throw new Error(`Migration ${m.name} was edited after it was applied (checksum mismatch)`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query('COMMIT');
        applied.push(m.version);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.name} failed and was rolled back: ${error.message}`, { cause: error });
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL is required (use the least-privilege migration role).');
    process.exit(2);
  }
  const applied = await migrate(url);
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date.');
}
