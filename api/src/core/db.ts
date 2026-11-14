import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Creates a bounded pool for one function instance. Keep `max` small: each SWA function instance
 * has its own pool and a provider-side pooler multiplexes them.
 */
export function createPool(connectionString: string, options: { max?: number } = {}): Db {
  const url = new URL(connectionString);
  const local = LOCAL_HOSTS.has(url.hostname);
  return new pg.Pool({
    connectionString,
    max: options.max ?? 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    application_name: 'pagelet-api',
    // Verify the server certificate for any remote PostgreSQL; local embedded test servers have none.
    ssl: local ? false : { rejectUnauthorized: true },
  });
}

/** Runs `fn` inside a transaction. Rolls back on any thrown error, including non-database failures. */
export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
