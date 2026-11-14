-- Development fixtures. Dummy data only; never use real customer emails or payments.
INSERT INTO shop_settings (id, shop_name, currency, timezone, creator_name, creator_bio, introduction)
VALUES (1, 'Dev Shop', 'EUR', 'Europe/Rome', 'Dev Creator', 'Writes sample courses.', 'Sample storefront for local work.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, slug, product_type, status, title, description, outcomes, price_minor)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'sample-course', 'course', 'published', 'Sample course',
   'A fictional course for local testing.', ARRAY['Learn the sample basics'], 4900),
  ('00000000-0000-4000-8000-000000000002', 'sample-workbook', 'download', 'published', 'Sample workbook',
   'A fictional PDF-style download.', ARRAY['Practice with a worksheet'], 1200)
ON CONFLICT (id) DO NOTHING;

INSERT INTO customers (id, email_normalized) VALUES
  ('00000000-0000-4000-9000-000000000001', 'buyer@example.test')
ON CONFLICT (id) DO NOTHING;
