-- Version 4: verified free-product claims (P04) and payment reconciliation bookkeeping (P05).
-- Additive: no existing row or constraint changes.

CREATE TABLE free_claim_tokens (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  email_normalized text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A customer receives at most one free grant per product, even when claims are retried or concurrent.
CREATE UNIQUE INDEX entitlement_grants_free_claim_unique
  ON entitlement_grants (customer_id, product_id) WHERE source = 'free_claim';

-- Reconciliation remembers the newest Stripe session it has scanned for each run window, so reruns resume.
CREATE TABLE reconciliation_runs (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  scanned integer NOT NULL DEFAULT 0 CHECK (scanned >= 0),
  fulfilled integer NOT NULL DEFAULT 0 CHECK (fulfilled >= 0),
  mismatches integer NOT NULL DEFAULT 0 CHECK (mismatches >= 0),
  next_cursor text
);
