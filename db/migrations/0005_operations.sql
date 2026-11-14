-- Version 5: owner operations (O02–O04), publication state (C04) and privacy controls.
-- Additive. Existing rows and constraints are unchanged.

-- At most one active complimentary grant per customer and product.
CREATE UNIQUE INDEX entitlement_grants_complimentary_active_unique
  ON entitlement_grants (customer_id, product_id)
  WHERE source = 'complimentary' AND status = 'active';

-- Publication: saving a product never makes it public; publishing records a versioned attempt with a stable key.
CREATE TABLE publications (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no >= 1),
  reason text NOT NULL CHECK (reason IN ('publish','archive','retry')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','building','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  build_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX publications_product_created_idx ON publications (product_id, created_at DESC);

-- Privacy: erasure keeps the financial record but removes personal identifiers from the customer row.
ALTER TABLE customers ADD COLUMN erased_at timestamptz;

CREATE INDEX login_tokens_expiry_idx ON login_tokens (expires_at);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);
CREATE INDEX email_outbox_recipient_idx ON email_outbox (recipient_email_normalized, created_at DESC);
CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
