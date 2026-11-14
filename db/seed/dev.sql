-- Development demo data. Fictional names and addresses only; never load real customer data here.
-- Loaded by tests/dev/server.ts into an empty local database.

INSERT INTO shop_settings (id, shop_name, currency, timezone, creator_name, creator_bio, introduction, accent_hex,
  seller_details, legal_pages, contact_links, tax_mode, digital_delivery_consent_version, featured_product_id)
VALUES (1, 'Pagelet Demo Shop', 'EUR', 'Europe/Rome', 'Ada Demo',
  'Ada writes practical guides about small-shop digital products.',
  'Courses and downloads from a fictional creator. Everything here is demo data.', '#244ACC',
  '{"legalName":"Ada Demo (sample)","address":"Via Esempio 1, Roma","contactEmail":"owner@shop.example.test"}',
  '{"terms":"/terms","privacy":"/privacy","refund":"/refunds"}',
  '[{"label":"Email","url":"mailto:owner@shop.example.test"}]',
  'none', 1, NULL);

-- Products. Status and versions match what the publication flow would have produced.
INSERT INTO products (id, slug, product_type, status, title, description, outcomes, price_minor, revision, published_version)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'course-one', 'course', 'published', 'Planning your first shop',
   'Six short lessons on setting up a digital shop, pricing and launch day.',
   ARRAY['Choose a price that works', 'Launch without a big audience'], 4900, 1, 1),
  ('00000000-0000-4000-8000-000000000002', 'free-guide', 'download', 'published', 'Free starter checklist',
   'A one-page checklist to get started. Free to claim.', ARRAY['Know the launch steps'], 0, 1, 1),
  ('00000000-0000-4000-8000-000000000003', 'workbook', 'download', 'published', 'Pricing workbook',
   'A spreadsheet-style workbook for testing prices.', ARRAY['Test three price points'], 1200, 1, 1),
  ('00000000-0000-4000-8000-000000000004', 'draft-course', 'course', 'draft', 'Coming soon: email funnels',
   'Not published yet. Visible only in the studio preview.', ARRAY['Write a funnel'], 2900, 1, NULL);

INSERT INTO product_versions (id, product_id, version_no, snapshot) VALUES
  ('00000000-0000-4000-8100-000000000001', '00000000-0000-4000-8000-000000000001', 1,
   '{"title":"Planning your first shop","slug":"course-one","description":"Six short lessons on setting up a digital shop, pricing and launch day.","outcomes":["Choose a price that works","Launch without a big audience"],"productType":"course","priceMinor":4900,"sections":[{"title":"Getting started","lessons":[{"title":"Welcome","kind":"text","isPreview":true},{"title":"Why digital products","kind":"video","isPreview":false}]},{"title":"Pricing and launch","lessons":[{"title":"Choosing a price","kind":"text","isPreview":false}]}]}'),
  ('00000000-0000-4000-8100-000000000002', '00000000-0000-4000-8000-000000000002', 1,
   '{"title":"Free starter checklist","slug":"free-guide","description":"A one-page checklist to get started. Free to claim.","outcomes":["Know the launch steps"],"productType":"download","priceMinor":0,"sections":[]}'),
  ('00000000-0000-4000-8100-000000000003', '00000000-0000-4000-8000-000000000003', 1,
   '{"title":"Pricing workbook","slug":"workbook","description":"A spreadsheet-style workbook for testing prices.","outcomes":["Test three price points"],"productType":"download","priceMinor":1200,"sections":[]}');

-- Curriculum for the course.
INSERT INTO sections (id, product_id, position, title) VALUES
  ('00000000-0000-4000-8200-000000000001', '00000000-0000-4000-8000-000000000001', 0, 'Getting started'),
  ('00000000-0000-4000-8200-000000000002', '00000000-0000-4000-8000-000000000001', 1, 'Pricing and launch');

-- Private media. Object keys point at nothing in local development: playback and downloads show their
-- error states, which is the point of testing them. Real files are never stored in the repository.
INSERT INTO assets (id, product_id, kind, object_key, status, mime_type, declared_bytes, actual_bytes, version_label, finalized_at) VALUES
  ('00000000-0000-4000-8300-000000000001', '00000000-0000-4000-8000-000000000001', 'video', 'dev/course-one/why-digital.mp4', 'ready', 'video/mp4', 2048000, 2048000, 'v1', now()),
  ('00000000-0000-4000-8300-000000000002', '00000000-0000-4000-8000-000000000003', 'file', 'dev/workbook/pricing-workbook.pdf', 'ready', 'application/pdf', 512000, 512000, 'v1', now()),
  ('00000000-0000-4000-8300-000000000003', '00000000-0000-4000-8000-000000000002', 'file', 'dev/free-guide/checklist.pdf', 'ready', 'application/pdf', 128000, 128000, 'v1', now()),
  ('00000000-0000-4000-8300-000000000004', '00000000-0000-4000-8000-000000000001', 'file', 'dev/course-one/course-notes.pdf', 'ready', 'application/pdf', 96000, 96000, 'v1', now());

INSERT INTO lessons (id, section_id, product_id, position, kind, title, is_preview, body_html, transcript, video_asset_id) VALUES
  ('00000000-0000-4000-8400-000000000001', '00000000-0000-4000-8200-000000000001', '00000000-0000-4000-8000-000000000001', 0, 'text', 'Welcome', true,
   '<p>Welcome to the course. This preview lesson is public.</p>', '', NULL),
  ('00000000-0000-4000-8400-000000000002', '00000000-0000-4000-8200-000000000001', '00000000-0000-4000-8000-000000000001', 1, 'video', 'Why digital products', false,
   '<p>Digital products have almost no marginal cost.</p>', 'Digital products have almost no marginal cost.', '00000000-0000-4000-8300-000000000001'),
  ('00000000-0000-4000-8400-000000000003', '00000000-0000-4000-8200-000000000002', '00000000-0000-4000-8000-000000000001', 0, 'text', 'Choosing a price', false,
   '<p>Start with three prices and watch what sells.</p>', '', NULL);

INSERT INTO lesson_resources (lesson_id, product_id, asset_id, position) VALUES
  ('00000000-0000-4000-8400-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8300-000000000004', 0);

-- Customers. The buyer owns the course and has started it; the second customer owns nothing.
INSERT INTO customers (id, email_normalized, created_at) VALUES
  ('00000000-0000-4000-8500-000000000001', 'buyer@example.test', now() - interval '20 days'),
  ('00000000-0000-4000-8500-000000000002', 'newcomer@example.test', now() - interval '2 days');

INSERT INTO checkout_attempts (id, product_id, product_version_id, email_normalized, idempotency_key, provider_session_id,
  amount_minor, currency, status, expires_at) VALUES
  ('00000000-0000-4000-8600-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8100-000000000001',
   'buyer@example.test', 'seed-attempt-1', 'cs_seed_0001', 4900, 'EUR', 'complete', now() - interval '19 days');

INSERT INTO orders (id, customer_id, checkout_attempt_id, provider_payment_id, status, amount_minor, refunded_minor, currency, policy_version, created_at) VALUES
  ('00000000-0000-4000-8700-000000000001', '00000000-0000-4000-8500-000000000001', '00000000-0000-4000-8600-000000000001',
   'pi_seed_0001', 'paid', 4900, 0, 'EUR', 1, now() - interval '19 days');

INSERT INTO order_items (id, order_id, product_id, product_version_id, title_snapshot, unit_price_minor, quantity) VALUES
  ('00000000-0000-4000-8800-000000000001', '00000000-0000-4000-8700-000000000001', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8100-000000000001', 'Planning your first shop', 4900, 1);

INSERT INTO entitlement_grants (id, customer_id, product_id, source, order_id, status) VALUES
  ('00000000-0000-4000-8900-000000000001', '00000000-0000-4000-8500-000000000001', '00000000-0000-4000-8000-000000000001', 'purchase',
   '00000000-0000-4000-8700-000000000001', 'active');

INSERT INTO entitlements (customer_id, product_id, status) VALUES
  ('00000000-0000-4000-8500-000000000001', '00000000-0000-4000-8000-000000000001', 'active');

INSERT INTO lesson_progress (customer_id, lesson_id, resume_seconds, completed_at) VALUES
  ('00000000-0000-4000-8500-000000000001', '00000000-0000-4000-8400-000000000001', 0, now() - interval '18 days');

-- One failed email, so the owner's retry screen has something to show.
INSERT INTO email_outbox (id, dedupe_key, recipient_email_normalized, template, payload, status, attempts, last_error) VALUES
  ('00000000-0000-4000-8a00-000000000001', 'seed:purchase-failed', 'newcomer@example.test', 'purchase_access',
   '{"orderId":"00000000-0000-4000-8700-000000000001"}', 'failed', 1, 'Mail provider returned HTTP 503');

INSERT INTO publications (id, product_id, version_no, reason, status, attempts, build_url) VALUES
  ('00000000-0000-4000-8b00-000000000001', '00000000-0000-4000-8000-000000000001', 1, 'publish', 'succeeded', 1, NULL);

UPDATE shop_settings SET featured_product_id = '00000000-0000-4000-8000-000000000001' WHERE id = 1;

INSERT INTO audit_events (actor, action, subject_type, subject_id, details) VALUES
  ('system:seed', 'seed.loaded', 'installation', 'shop', '{"note":"demo data"}'),
  ('system:stripe', 'order.created', 'order', '00000000-0000-4000-8700-000000000001', '{"productId":"00000000-0000-4000-8000-000000000001"}');
