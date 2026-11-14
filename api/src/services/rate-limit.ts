import type { Db } from '../core/db.js';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter in PostgreSQL, so every function instance shares the same budget.
 * Keys should be hashed identifiers (for example sha256 of a normalized email), never raw values.
 */
export async function consumeRateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const { rows } = await db.query<{ hits: number; window_start: Date; retry_after: number }>(
    `INSERT INTO rate_limits (bucket_key, window_start, hits)
     VALUES ($1, now(), 1)
     ON CONFLICT (bucket_key) DO UPDATE SET
       window_start = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => $2)
                           THEN now() ELSE rate_limits.window_start END,
       hits = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => $2)
                   THEN 1 ELSE rate_limits.hits + 1 END
     RETURNING hits, window_start,
       GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => $2) - now()))))::int AS retry_after`,
    [key, windowSeconds],
  );
  const row = rows[0];
  return { allowed: row.hits <= limit, retryAfterSeconds: row.retry_after };
}
