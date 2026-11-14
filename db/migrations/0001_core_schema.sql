-- Pagelet core schema, version 1.
-- Invariants follow docs/ARCHITECTURE.md (Data model, Purchase integrity).
-- Money is integer minor units plus an ISO 4217 currency code. Instants are timestamptz (UTC).
-- Application requests never run this file; see db/README.md and scripts/migrate.mjs.

CREATE TABLE shop_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),           -- exactly one singleton row
  shop_name text NOT NULL DEFAULT 'My shop' CHECK (char_length(shop_name) BETWEEN 1 AND 120),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  timezone text NOT NULL DEFAULT 'UTC',
  accent_hex char(7) NOT NULL DEFAULT '#244ACC' CHECK (accent_hex ~ '^#[0-9A-Fa-f]{6}$'),
  creator_name text NOT NULL DEFAULT '',
  creator_bio text NOT NULL DEFAULT '',
  introduction text NOT NULL DEFAULT '',
  featured_product_id uuid,                                    -- FK added after products
  seller_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  legal_pages jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  tax_mode text NOT NULL DEFAULT 'unset' CHECK (tax_mode IN ('unset','none','stripe_tax_configured')),
  digital_delivery_consent_version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 80),
  product_type text NOT NULL CHECK (product_type IN ('course','download')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  outcomes text[] NOT NULL DEFAULT '{}',
  price_minor integer NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),  -- optimistic concurrency token
  published_version integer,                                   -- latest publication snapshot shown publicly
  cover_asset_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shop_settings
  ADD CONSTRAINT shop_settings_featured_fk FOREIGN KEY (featured_product_id) REFERENCES products(id) ON DELETE RESTRICT;

CREATE TABLE product_versions (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no >= 1),
  snapshot jsonb NOT NULL,                                     -- immutable publication/purchase snapshot
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, version_no)
);

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('file','video','caption','image','cover')),
  object_key text NOT NULL UNIQUE,                             -- private blob path; never a public URL
  status text NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload','quarantined','ready','rejected','deleted')),
  mime_type text NOT NULL,
  declared_bytes bigint NOT NULL CHECK (declared_bytes > 0),
  actual_bytes bigint CHECK (actual_bytes IS NULL OR actual_bytes >= 0),
  version_label text NOT NULL DEFAULT 'v1',
  replaces_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  UNIQUE (id, product_id)                                      -- target of composite FKs below
);

ALTER TABLE products
  ADD CONSTRAINT products_cover_fk FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE RESTRICT;

CREATE TABLE sections (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  UNIQUE (product_id, id),
  CONSTRAINT sections_position_unique UNIQUE (product_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE lessons (
  id uuid PRIMARY KEY,
  section_id uuid NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position >= 0),
  kind text NOT NULL CHECK (kind IN ('video','text')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  body_html text NOT NULL DEFAULT '',                          -- sanitized by the application before storage
  video_asset_id uuid,
  caption_asset_id uuid,
  transcript text NOT NULL DEFAULT '',
  is_preview boolean NOT NULL DEFAULT false,
  UNIQUE (id, product_id),
  CONSTRAINT lessons_section_product_fk FOREIGN KEY (product_id, section_id) REFERENCES sections(product_id, id) ON DELETE RESTRICT,
  CONSTRAINT lessons_position_unique UNIQUE (section_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT lessons_video_asset_fk FOREIGN KEY (video_asset_id, product_id) REFERENCES assets(id, product_id) ON DELETE RESTRICT,
  CONSTRAINT lessons_caption_asset_fk FOREIGN KEY (caption_asset_id, product_id) REFERENCES assets(id, product_id) ON DELETE RESTRICT
  -- Drafts may be video lessons without an uploaded video; publication validation requires media.
);

CREATE TABLE lesson_resources (
  lesson_id uuid NOT NULL,
  product_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (lesson_id, asset_id),
  CONSTRAINT lesson_resources_lesson_fk FOREIGN KEY (lesson_id, product_id) REFERENCES lessons(id, product_id) ON DELETE RESTRICT,
  CONSTRAINT lesson_resources_asset_fk FOREIGN KEY (asset_id, product_id) REFERENCES assets(id, product_id) ON DELETE RESTRICT
);

CREATE TABLE customers (
  id uuid PRIMARY KEY,
  email_normalized text NOT NULL UNIQUE CHECK (email_normalized = lower(email_normalized) AND char_length(email_normalized) BETWEEN 3 AND 320),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_tokens (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),   -- SHA-256 of the random token
  email_normalized text NOT NULL,
  return_path text NOT NULL DEFAULT '/library' CHECK (return_path LIKE '/%' AND return_path NOT LIKE '//%'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_tokens_email_created_idx ON login_tokens (email_normalized, created_at);

CREATE TABLE sessions (
  id_hash bytea PRIMARY KEY CHECK (octet_length(id_hash) = 32),        -- SHA-256 of the cookie value
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_customer_idx ON sessions (customer_id);

CREATE TABLE rate_limits (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits >= 0)
);

CREATE TABLE checkout_attempts (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_version_id uuid NOT NULL REFERENCES product_versions(id) ON DELETE RESTRICT,
  email_normalized text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  provider_session_id text UNIQUE,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','expired','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE orders (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  checkout_attempt_id uuid NOT NULL UNIQUE REFERENCES checkout_attempts(id) ON DELETE RESTRICT,
  provider_payment_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','partially_refunded','refunded','disputed')),
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  refunded_minor integer NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0 AND refunded_minor <= amount_minor),
  currency char(3) NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_version_id uuid NOT NULL REFERENCES product_versions(id) ON DELETE RESTRICT,
  title_snapshot text NOT NULL,
  unit_price_minor integer NOT NULL CHECK (unit_price_minor >= 0),
  quantity integer NOT NULL CHECK (quantity = 1),
  UNIQUE (order_id, product_id)
);

CREATE TABLE refunds (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider_refund_id text NOT NULL UNIQUE,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entitlement_grants (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('purchase','complimentary','free_claim')),
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_source_order CHECK ((source = 'purchase') = (order_id IS NOT NULL))
);
-- One purchase grant per order and product; several orders may still stack as separate grants.
CREATE UNIQUE INDEX entitlement_grants_order_product_unique ON entitlement_grants (order_id, product_id) WHERE order_id IS NOT NULL;
CREATE INDEX entitlement_grants_customer_product_idx ON entitlement_grants (customer_id, product_id);

-- Effective access: one row per customer and product, recomputed from grants inside the same transaction.
CREATE TABLE entitlements (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active','suspended','revoked')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);

CREATE TABLE lesson_progress (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE RESTRICT,
  resume_seconds integer NOT NULL DEFAULT 0 CHECK (resume_seconds >= 0 AND resume_seconds <= 86400),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, lesson_id)
);

CREATE TABLE webhook_events (
  provider_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','processed','failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error text
);

CREATE TABLE email_outbox (
  id uuid PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  recipient_email_normalized text NOT NULL,
  template text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,                 -- never contains raw login tokens
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,                                        -- 'owner', 'customer:<id>', 'system:stripe'
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,                 -- redacted before insert
  created_at timestamptz NOT NULL DEFAULT now()
);
