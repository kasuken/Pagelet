# HTTP API reference (living)

All endpoints live under `/api` (managed Azure Functions, programming model v4, Node.js 22). Source of truth: `api/src/functions/*.ts`
and the schemas in `packages/contracts/src/index.ts`. The frontend must call only these endpoints.

## Conventions

- **Errors:** `{ "error": { "code", "message", "requestId", "issues?" } }`. Codes: `validation_failed` (400, `issues[]`),
  `unauthorized` (401), `forbidden` (403), `origin_rejected` (403), `not_found` (404), `method_not_allowed` (405),
  `conflict` (409), `unsupported_media_type` (415), `payload_too_large` (413), `rate_limited` (429, `Retry-After`),
  `service_unavailable` (503), `internal_error` (500).
- **Request IDs:** every response has `X-Request-Id`. Send your own `X-Request-Id` (8–64 alphanumeric/hyphen characters) to correlate.
- **Bodies:** JSON only (`Content-Type: application/json`), bounded (16 KB default; webhooks 512 KB).
- **Cookie mutations:** require `Origin` equal to the configured app origin; otherwise `origin_rejected`.
- **Caching:** private responses are `Cache-Control: private, no-store`. Public catalog responses use short `public` caching.
- **Money:** integers in minor units plus an ISO currency (`{ amountMinor, currency }`). Times are ISO-8601 UTC.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | none | `{ status, database: ok|not_configured|unreachable, checkedAt }`. No secrets. |
| POST | `/api/auth/login-links` | none (Origin) | Body `{ email, returnTo? }`. Always `202` with the same message, whether or not the account exists. Rate-limited. |
| POST | `/api/auth/sessions` | sign-in token | Body `{ token }`. Consumes the single-use token, sets the `__Host-pagelet_session` cookie, returns `{ returnTo }`. Call only from an explicit button press. |
| POST | `/api/auth/logout` | session (Origin) | Revokes the session; `204`. |
| GET | `/api/me` | customer session | `{ customer: { maskedEmail } }`. `401` when signed out or expired. |
| GET | `/api/library` | customer session | `{ items: LibraryItem[] }` for the buyer's active or suspended entitlements. |
| GET | `/api/owner/me` | SWA identity matching the configured owner | `{ owner: { provider } }`. `503` when the owner is unconfigured; `403` for any other identity. |
| GET | `/api/shop` | none | Public shop profile: `shopName`, `creator {name,bio}`, `introduction`, `accentHex`, `currency`, `contactLinks`, `legal {terms,privacy,refund}` (paths or null). |
| GET | `/api/catalog` | none | `{ items: PublicProduct[] }`: only products whose published snapshot is live. Public caching. No drafts, no private lesson content, no storage keys. |
| GET | `/api/catalog/{slug}` | none | One public product with its outline; preview lesson bodies are not included in this version. `404` for drafts and archived products. |
| GET | `/api/library` | customer session | `{ items: LibraryItem[] }`. Revoked items are listed with `status: revoked` (no download). |
| GET | `/api/library/products/{slug}/curriculum` | customer session | Sections and lessons with the buyer's progress. `404` without an active entitlement. |
| GET | `/api/lessons/{lessonId}` | customer session | Lesson body, transcript and resource references. Other customers and unowned lessons get `404`. |
| GET | `/api/lessons/{lessonId}/playback?track=video\|caption` | customer session | Short-lived read URL (15 min), plus `resumeSeconds`. Rechecked on every call. |
| PUT | `/api/lessons/{lessonId}/progress` | customer session (Origin) | Body `{ resumeSeconds, completed? }`. Resume is bounded (0–86400). Completion is explicit and is not cleared by position saves. |
| GET | `/api/assets/{assetId}/download` | customer session | Short-lived (5 min) download URL for a purchased file. Revoked access gets `404`. |
| GET | `/api/orders`, `/api/orders/{orderId}` | customer session | Receipts for the buyer's own orders. No provider identifiers or card data. Other IDs return `404`. |
| POST | `/api/checkout` | none (Origin, `Idempotency-Key` header) | Body `{ slug, email }`. Server prices the product. Returns `{ url }` for the Stripe Checkout redirect. `409` lists missing launch settings. |
| GET | `/api/checkout/status?sessionId=` | none | `{ status: pending|paid|failed|expired }`. Observes state only; never grants access. |
| POST | `/api/free-claims` | none (Origin) | Body `{ slug, email }`. Always `202`; sends a confirmation link for free products only. |
| POST | `/api/free-claims/confirm` | none (Origin) | Body `{ token }`. Single use. Returns `{ productSlug, alreadyClaimed }`. |
| POST | `/api/webhooks/stripe` | Stripe signature | Raw-body signed webhook. `200` after durable processing; `500` asks Stripe to retry; `400` for bad signatures. |
| GET | `/api/me/export` | customer session | The buyer's own data as JSON. |
| POST | `/api/me/sessions/revoke` | customer session (Origin) | Signs out every session for the buyer. |
| POST | `/api/me/erase` | customer session (Origin) | Body `{ confirm: "DELETE" }`. Erases the account; order records are kept with the identity removed. |
| GET | `/api/owner/overview` | owner | Sales, product counts, open disputes, failed webhooks and emails, and `checkoutReady` with missing items. |
| GET | `/api/owner/orders?status&cursor&limit` | owner | Keyset-paged orders (`nextCursor`). |
| GET | `/api/owner/orders/{orderId}` | owner | Order detail with items, refunds, grants and audit events. |
| GET | `/api/owner/customers?q=` | owner | Customer search by email prefix. |
| GET | `/api/owner/customers/{customerId}` | owner | Customer detail with entitlements and orders. |
| POST | `/api/owner/customers/{customerId}/complimentary` | owner (Origin) | Body `{ productId, reason }`. Audited. `409` if already granted. |
| POST | `/api/owner/grants/{grantId}/revoke` | owner (Origin) | Body `{ reason }`. Complimentary grants only; purchases change through refunds in Stripe. |
| GET | `/api/owner/emails?status=failed\|pending` | owner | Outbox rows with template, attempts and redacted error. |
| POST | `/api/owner/emails/{emailId}/retry` | owner (Origin) | `{ result: sent|failed|not_retryable }`. Login and claim links are not retryable: the customer requests a new one. |
| GET | `/api/owner/audit?cursor` | owner | Audit trail, keyset-paged. |
| POST | `/api/owner/retention` | owner (Origin) | Body `{ confirm: "RUN" }`. Removes expired tokens, sessions and old outbox rows. Never deletes orders. |
| POST | `/api/owner/customers/{customerId}/erase` | owner (Origin) | Body `{ confirm: "ERASE" }`. Keeps orders; removes identity. |
| POST | `/api/owner/reconciliation` | owner (Origin) | Body `{ createdSinceUnix?, startingAfter?, limit? }`. Pulls completed Stripe sessions and fulfils missed ones. Returns `nextCursor`. |
| GET | `/api/owner/webhooks` | owner | Failed webhook events with reason (no payload stored). |
| GET | `/api/owner/products/{productId}/preview` | owner | Draft preview including unpublished content. `Cache-Control: private, no-store`. |
| POST | `/api/owner/products/{productId}/publish` | owner (Origin) | Snapshots the version and starts a static build. `202` with `publicationId`. Public content changes only after the build succeeds. |
| POST | `/api/owner/products/{productId}/archive` | owner (Origin) | Removes the product from the public catalog after the next build. |
| POST | `/api/owner/publications/{publicationId}/retry` | owner (Origin) | Retries a failed build with the same publication ID. |
| POST | `/api/internal/publications/{publicationId}/result` | `Authorization: Bearer <PUBLISH_TOKEN>` | Build callback. Advances the public version only for a newer successful build. |
| * | `/api/{anything else}` | — | `404 not_found` JSON. Never the SPA shell. |

### Owner catalog, curriculum, media and shop (all owner-only, Origin-checked on mutations)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/owner/products` | List products with editor readiness. |
| POST | `/api/owner/products` | Create a draft product. |
| GET | `/api/owner/products/{id}` | Product detail with `publishReadiness` and `revision`. |
| PATCH | `/api/owner/products/{id}` | Update; requires the current `revision` (`409 conflict` when stale). |
| DELETE | `/api/owner/products/{id}` | Delete a draft that was never sold. |
| POST | `/api/owner/products/{id}/sections` | Add a section. |
| POST | `/api/owner/products/{id}/sections/reorder` | Reorder with the full ordered list of section IDs. |
| PATCH / DELETE | `/api/owner/sections/{id}` | Rename or delete a section. |
| POST | `/api/owner/sections/{id}/lessons` | Add a lesson (video or text). |
| POST | `/api/owner/sections/{id}/lessons/reorder` | Reorder lessons in a section. |
| PATCH / DELETE | `/api/owner/lessons/{id}` | Edit or delete a lesson. Rich text is sanitised on write. |
| GET / PATCH | `/api/owner/shop` | Shop settings, branding and legal fields. Accent colour must meet 4.5:1 contrast. |
| POST | `/api/owner/media/uploads` | Issue a single-blob upload URL for a new asset (server-derived key). |
| POST | `/api/owner/media/uploads/{id}/finalize` | Verify size, type and signature; `400` on mismatch, `409` when the object is missing. |
| DELETE | `/api/owner/media/uploads/{id}` | Abort a pending upload and remove its blob. |
| DELETE | `/api/owner/media/assets/{id}` | Delete an asset not referenced by a sale. |
| GET | `/api/owner/media/usage` | Storage used against the quota. |
| POST | `/api/owner/media/cleanup` | Remove abandoned and rejected uploads (requires `confirm`). Never removes ready or referenced assets. |
| GET | `/api/owner/products/{productId}/publications` | Publication history: queued, building, succeeded or failed, with the build link and last error. |

### Learner additions

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/library/products/{slug}/files` | Ready files of a purchased product (`assetId`, `versionLabel`, `mimeType`, `bytes`). `404` without an active entitlement. |

`GET /api/owner/customers/{id}` now includes `grants` with IDs, so complimentary access can be revoked after a reload.

Session errors from `POST /api/auth/sessions` and `POST /api/free-claims/confirm`: an expired, used, or unknown token returns `401 unauthorized` with a message to request a new link. Malformed bodies return `400 validation_failed`.

## Owner configuration

Set in the Static Web App settings (not in the browser bundle): `OWNER_IDENTITY_PROVIDER` (for example `github`) and
`OWNER_USER_ID` (the provider's immutable user ID). Both are required; if either is missing, owner endpoints fail closed.
