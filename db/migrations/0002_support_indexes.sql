-- Version 2: indexes for owner order/support views (O02) and outbox retry lists (A04).
-- Additive only: existing rows and constraints are unchanged, so an installation upgrades in place.

CREATE INDEX orders_customer_created_idx ON orders (customer_id, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at DESC);
CREATE INDEX email_outbox_status_created_idx ON email_outbox (status, created_at DESC) WHERE status <> 'sent';
CREATE INDEX audit_events_subject_idx ON audit_events (subject_type, subject_id, created_at DESC);
CREATE INDEX lesson_progress_lesson_idx ON lesson_progress (lesson_id);
