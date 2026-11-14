# Changelog

All notable changes to Pagelet are recorded here. Versions follow [Semantic Versioning](https://semver.org/).

## 0.0.1 - 2026-11-14

**This is the first version of Pagelet.** It is a pre-release for evaluation. It has not been deployed to Azure, has not taken a live payment, and has not been reviewed for production use. Read the limits below before using it.

### Added

- Foundation (E01): pnpm workspace on Node 22 with pinned dependencies; PostgreSQL schema and versioned migrations (0001–0005) with purchase integrity enforced by constraints; least-privilege database roles; CI workflow with pinned action SHAs.
- Owner identity and customer access (E02): exactly one configured owner, checked on every admin route; passwordless sign-in with single-use, hashed, expiring links; rotated sessions; origin checks; rate limits; centralised entitlement checks; transactional email outbox.
- Catalog and curriculum (E03): product editor with revisions and slug checks; sections and lessons with an allow-list sanitiser; downloads; shop branding with WCAG contrast checks and a currency lock.
- Media (E04): owner-only uploads with server-derived keys; finalisation checks; authorised download and playback links; storage quotas; confirm-gated cleanup; private storage template (Bicep, not built).
- Storefront and design system (E05): tokens and accessible components; catalog, product pages, checkout return; learner and studio interfaces.
- Payments and fulfilment (E06): server-priced Stripe Checkout; idempotent signed webhook fulfilment; refund and dispute handling; verified free-product claims; receipts; reconciliation of missed sessions.
- Learner workspace (E07): library, curriculum, lesson player with resume, progress saved only after confirmation, downloads, account export and erase.
- Owner operations (E08): overview, orders and customers, complimentary access with audit, failed-email retry, retention, erasure, publication history.
- Publication (C04): draft-to-public publishing with a last-good public version, retry and archive.
- Local demo: a development-only API server with seeded demo data.

### Known limits

- Azure: the managed API did not register during the free-tier spike. Hosted deployment is not verified.
- Live services are not verified: Stripe, email delivery, blob storage, the GitHub publish workflow, and the Bicep build.
- Storage CORS must be configured on a deployed account before uploads and video playback work.
- The per-source rate limit trusts the first `x-forwarded-for` entry.
- Download products show no file list in the learner UI until the customer endpoint is used by the UI.
- Refund and dispute reconciliation is not implemented; only checkout sessions are reconciled.

### Verification at this release

- Integration tests: 208 passing (real PostgreSQL 18, embedded).
- API unit tests: 50 passing.
- Web tests: 89 passing; typecheck, build and lint clean.

See `docs/VERIFICATION.md` for the per-story ledger of what is met, partial, or waiting on a live environment.
