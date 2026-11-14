-- Version 3: owner catalog, branding, media lifecycle and purchase-snapshot immutability.
-- Additive over version 1 and 2: no applied migration is edited. Existing rows remain valid.

-- Shop logo is a product-less asset. Every other asset still belongs to exactly one product.
ALTER TABLE assets ALTER COLUMN product_id DROP NOT NULL;

DO $$
DECLARE
  kind_check text;
BEGIN
  SELECT c.conname INTO kind_check
    FROM pg_constraint c
   WHERE c.conrelid = 'assets'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%kind%';
  IF kind_check IS NULL THEN
    RAISE EXCEPTION 'assets kind check constraint not found';
  END IF;
  EXECUTE format('ALTER TABLE assets DROP CONSTRAINT %I', kind_check);
END $$;

ALTER TABLE assets
  ADD CONSTRAINT assets_kind_check CHECK (kind IN ('file','video','caption','image','cover','logo')),
  ADD CONSTRAINT assets_product_scope_check CHECK ((kind = 'logo') = (product_id IS NULL)),
  ADD CONSTRAINT assets_ready_fields_check CHECK (status <> 'ready' OR (actual_bytes IS NOT NULL AND finalized_at IS NOT NULL));

-- A cover must belong to the same product it decorates (composite key replaces the single-column FK).
ALTER TABLE products DROP CONSTRAINT products_cover_fk;
ALTER TABLE products
  ADD CONSTRAINT products_cover_same_product_fk FOREIGN KEY (cover_asset_id, id) REFERENCES assets(id, product_id);

-- Update availability for existing buyers: 'latest' gives every ready file; 'pinned' gives files finalized before purchase.
ALTER TABLE products
  ADD COLUMN update_policy text NOT NULL DEFAULT 'latest' CHECK (update_policy IN ('latest','pinned')),
  ADD COLUMN cover_alt text NOT NULL DEFAULT '' CHECK (char_length(cover_alt) <= 300);

ALTER TABLE shop_settings
  ADD COLUMN logo_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  ADD COLUMN logo_alt text NOT NULL DEFAULT '' CHECK (char_length(logo_alt) <= 300),
  ADD COLUMN legal_policy_version integer NOT NULL DEFAULT 0 CHECK (legal_policy_version >= 0);

-- Currency is immutable once any order exists. The application checks this too; the trigger is the backstop.
CREATE FUNCTION shop_currency_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency AND EXISTS (SELECT 1 FROM orders) THEN
    RAISE EXCEPTION 'shop currency is immutable after the first order' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER shop_settings_currency_lock
  BEFORE UPDATE OF currency ON shop_settings
  FOR EACH ROW EXECUTE FUNCTION shop_currency_lock();

-- Publication snapshots are append-only: a later price or title change never rewrites history.
CREATE FUNCTION reject_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'product_versions rows are immutable' USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER product_versions_immutable
  BEFORE UPDATE OR DELETE ON product_versions
  FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();

CREATE INDEX assets_status_created_idx ON assets (status, created_at);
CREATE INDEX lessons_video_asset_idx ON lessons (video_asset_id) WHERE video_asset_id IS NOT NULL;
CREATE INDEX lessons_caption_asset_idx ON lessons (caption_asset_id) WHERE caption_asset_id IS NOT NULL;
CREATE INDEX assets_replaces_idx ON assets (replaces_asset_id) WHERE replaces_asset_id IS NOT NULL;
