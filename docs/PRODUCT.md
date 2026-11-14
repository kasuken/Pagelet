# Product brief

## Purpose

Let an independent creator launch a polished shop for their expertise without buying a large learning platform subscription or operating a complex application. The creator owns one installation and brings their own payment account, database, and storage.

Brand: **Pagelet**. Tagline: **Your website. Your products. Your start.**

## People and scope

- **Visitor:** discovers products, reads curriculum and previews, buys a product.
- **Customer/learner:** verifies their email, opens purchases, learns, downloads files, and checks receipts.
- **Owner:** the installation's one configured administrator, with publishing and sales access.

“No multi-user system” means no multiple merchants, admins, teams, organizations, tenant selector, or role-management interface. Many customers can purchase and learn. Customer identity is necessary to protect purchases and preserve progress.

## Core release

### Publish

Course or download product; title, slug, cover, description, outcomes, price in the shop currency, draft/published/archived state. Course sections contain ordered video/text lessons and file resources. Reordering works with keyboard controls. Save drafts explicitly and warn before discarding unsaved edits. Admin preview does not expose drafts publicly.

Accepted starting assets: MP4 H.264/AAC video, PDF, EPUB, ZIP, MP3, PNG, and JPEG. Upload limits are deployment settings. Executables and active HTML/SVG uploads are excluded. Videos are prepared before upload; Pagelet does not transcode. Captions use WebVTT with an accessible transcript alternative.

### Sell

One product per checkout initially. One shop currency, integer minor-unit prices, no custom card form. Stripe Checkout collects payment and required billing information. Free products use a separate verified claim flow. Signed, idempotent webhooks create the paid order and entitlement. The return page can show pending payment and safely check status. Duplicate callbacks cannot duplicate access or emails.

Tax mode, seller identity, terms, privacy, refund policy, and required digital-delivery consent are installation choices with a launch gate. Stripe Tax is optional and must be explicitly configured; Pagelet does not claim to be a merchant of record or automatically handle registrations/remittance. No hidden default jurisdiction.

### Deliver and learn

Customers receive access instructions and verify an email link to open a private library. One entitlement per customer/product; order records preserve immutable purchase details. Purchased courses open a responsive player with sections, captions, transcript, resources, and progress. Downloads use short-lived links; refunded/revoked purchases cannot mint new ones. Already downloaded files cannot be recalled.

### Operate

The owner sees sales, orders, fulfillment exceptions, product performance, and a simple customer purchase view. Refund creation and payment disputes are handled in Stripe's dashboard in v1; synchronized status controls Pagelet access. Manual complimentary enrollment/revocation is audited. Full refunds revoke access; partial refunds retain access by default and show an explicit owner action. Open disputes suspend access; an authoritative final event restores or revokes it.

Basic branding: shop name, logo, accent color with contrast validation, creator profile, hero text, selected featured product, and contact/legal links. This is a curated storefront template, not a freeform page builder.

## Following the core release

Coupons, fixed-price product bundles, simple quizzes, completion certificates, and drip schedules. The backlog includes these in a separate milestone, with core dependencies.

## Explicitly outside this roadmap

Multi-tenancy, team permissions, marketplace payouts, coaching calendars, community chat, affiliates, subscriptions/memberships, installments, native mobile apps, SCORM, AI generation, a blog/CMS, drag-anything page building, DRM, and video transcoding. Reconsider only with measured demand and a cost proposal.

## Success and release gates

- A new owner can follow the installation guide, publish one course and one download, and complete a sandbox purchase.
- A purchase grants access exactly once, including duplicate webhooks and a lost browser redirect.
- Another customer, an anonymous request, and an unconfigured identity cannot access private content or owner APIs.
- A full refund blocks new content URLs; entitlement changes are auditable.
- Mobile browsing, checkout handoff, learning, and owner editing are keyboard usable and tested against WCAG 2.2 AA criteria.
- Product metadata is crawlable; private routes are excluded from indexing and public caches.
- Backup restoration, deployment rollback, and order reconciliation have been rehearsed.
- A measured cost worksheet covers a pilot and a growth workload before live payments are enabled.

Proposed performance budgets: public first-load JS ≤180 KB gzip (excluding lazy admin/player code), LCP ≤2.5s on the agreed mobile lab profile, CLS ≤0.1. Separate warm API latency from cold starts; measure the latter on the actual SWA deployment before setting its SLO. No invented availability guarantee.
