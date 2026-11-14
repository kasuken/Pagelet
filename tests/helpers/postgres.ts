import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { migrate } from '@pagelet/db/migrate.mjs';

export interface TestDatabase {
  url: string;
  /** A fresh, empty database on the shared server, migrated to head. */
  createMigrated(name: string): Promise<string>;
  stop(): Promise<void>;
}

/** Starts one embedded PostgreSQL server for the test run. No Docker, no root. */
export async function startPostgres(port = 54_329): Promise<TestDatabase> {
  const dataDir = await mkdtemp(join(tmpdir(), 'pagelet-pg-'));
  const server = new EmbeddedPostgres({
    databaseDir: join(dataDir, 'data'),
    user: 'postgres',
    password: 'postgres-test',
    port,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  await server.initialise();
  await server.start();
  const admin = `postgres://postgres:postgres-test@127.0.0.1:${port}`;
  return {
    url: admin,
    async createMigrated(name: string) {
      const client = new pg.Client({ connectionString: `${admin}/postgres` });
      await client.connect();
      await client.query(`CREATE DATABASE ${name}`);
      await client.end();
      const url = `${admin}/${name}`;
      await migrate(url);
      return url;
    },
    async stop() {
      await server.stop();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
