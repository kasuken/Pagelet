# Database

PostgreSQL 16+ (tested against PostgreSQL 18 with embedded-postgres). Money is integer minor units with a currency
code; timestamps are `timestamptz`.

## Migrations

- Files: `db/migrations/NNNN_name.sql`, applied in order, each in its own transaction.
- `db/migrate.mjs` takes `pg_advisory_lock` so concurrent runs serialize, and stores a SHA-256 checksum per file.
  An edited, already-applied migration fails loudly.
- Run with the **migration role** only: `MIGRATION_DATABASE_URL=... node db/migrate.mjs`.
- Application requests never migrate. The runtime role has DML only (see `db/roles.sql`).

## Roles

`db/roles.sql` creates `pagelet_migrator` (DDL, owns objects) and `pagelet_runtime` (SELECT/INSERT/UPDATE/DELETE, no DDL).
Run it once as a superuser or the database owner. Replace placeholder passwords from your secret store.

## Local development

`pnpm --filter ./tests run test:integration` starts an embedded PostgreSQL instance (no Docker) and runs migrations
against it. `db/seed/dev.sql` loads dummy fixtures for manual work. Never load real customer data locally.
