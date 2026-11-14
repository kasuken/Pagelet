-- Least-privilege roles. Run once as a superuser or database owner.
-- Replace the placeholder passwords with values from your secret store (never commit real ones).
-- psql -v dbname=pagelet -v migrator_password=... -v runtime_password=... -f db/roles.sql

CREATE ROLE pagelet_migrator LOGIN PASSWORD :'migrator_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE pagelet_runtime LOGIN PASSWORD :'runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE :"dbname" TO pagelet_migrator, pagelet_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO pagelet_migrator;
GRANT USAGE ON SCHEMA public TO pagelet_runtime;

-- Runtime gets DML on existing and future tables created by the migrator; no DDL, no TRUNCATE.
ALTER DEFAULT PRIVILEGES FOR ROLE pagelet_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pagelet_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE pagelet_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pagelet_runtime;
