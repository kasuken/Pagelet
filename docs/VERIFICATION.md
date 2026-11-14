# Verification record

Prepared 2026-11-14.

## Completed

- Backlog validation: 11 unique epics, 48 unique stories; every dependency resolves and the dependency graph is acyclic.
- Seven publication tests: complete import plus rerun, interruption recovery, duplicate-marker rejection, parent-conflict rejection, refusal to expose a private repository, no creation on network/auth errors, and rejection of invalid/cyclic dependencies.
- JavaScript syntax check for the interactive prototype.
- Python compilation checks for validation and publication scripts.
- Local HTML checks for unique IDs, valid fragment references, local asset links, and form label targets.
- Git whitespace check.

## Not completed

- Live GitHub publication: `api.github.com` was unavailable from the shell; connector tools could read the account but did not expose repository creation or native sub-issue mutations. The intended repository returned 404.
- Browser visual and interaction checks: the available Playwright package referenced a missing bundled browser. Launching installed Chromium failed because the sandbox denied a required socket operation. No screenshots or browser-test success are claimed.
- Production build, deployment, authentication, payments, database integration and cloud costs: these are future implementation stories. This repository currently contains a design prototype and delivery plan.

## Reproduce local checks

```sh
python3 scripts/validate_backlog.py
python3 -m unittest discover -s scripts -p 'test_*.py' -v
python3 -m py_compile scripts/validate_backlog.py scripts/publish_github.py
node --check design/app.js
git diff --check
```

## Browser review to perform in an unrestricted environment

Open `design/index.html` at 360px, 768px and 1440px. Inspect all three screens and long sample draft names. Check filters/count announcements, product dialog close/Escape/focus restoration, lesson selection/completion, studio navigation, and temporary draft creation. Confirm there is no horizontal page overflow; tables may scroll within their container. Verify 200% zoom, reduced motion and keyboard-only operation. Capture desktop/mobile screenshots before treating the visual direction as reviewed.

The prototype uses only local HTML/CSS/JS and makes no payment or API calls. All draft changes and completion state disappear on reload.

## Implementation ledger (E01–E08), prepared 2026-11-14

Legend: **Met** = code plus an automated test that ran. **Partial** = code exists but a named check is missing or not run.
**Live** = needs a real Azure, Stripe, mail or GitHub environment that has not been exercised. Tests: `tests/integration` (real PostgreSQL 18 via embedded-postgres, 117 tests in 12 files), `api/test` (50 unit tests), `apps/web` (72 tests).

| Story | Status | What ran | Still open |
| --- | --- | --- | --- |
| F01 | Partial | Free-tier SWA created and static content deployed; the API did not register on the spike (see ADR 0001) | Managed API 404 not explained; the forwarded-IP, principal-header and override questions unanswered; PostgreSQL not provisioned |
| F02 | Met (local) | Install from lockfile, lint, typecheck, builds, route 404 contract tested | Local SWA emulator smoke not run |
| F03 | Met | Constraint tests, upgrade 1→5 with data, checksum tamper refusal | Concurrent-migration lock test not written; roles file untested against a real role setup |
| F04 | Partial | CI workflow with pinned SHAs written; error envelope, request IDs, body limits, cache policy tested | Workflow not executed on GitHub |
| A01 | Met (local) | Anonymous, wrong provider, wrong ID, unconfigured fail-closed, customer session never owner; route matrix over every owner route | Deployed-SWA header behaviour not verified (ADR 0001) |
| A02 | Met (mail live pending) | Expiry, replay, scanner GET, Origin, rotation, enumeration-identical responses, rate limit, hashed storage | Provider delivery not exercised |
| A03 | Met | Cross-customer, revoked, draft, lesson and asset resolution; route matrix (customer routes need a session) | — |
| A04 | Partial | Outbox written in the same transaction; rollback on failure; failed send recorded; idempotent retry | Transport-timeout test not written (bound is set to 8 s) |
| C01 | Met | Slug 409, revision 409, archive vs delete, snapshot immutability (catalog agent tests) | — |
| C02 | Met | Reorder, sanitizer with 28 hostile fixtures, cross-product 400 | Moving a lesson between sections not built |
| C03 | Met | Multi-file, version labels, replacement keeps old object, sold-file delete 409 | Upload progress UI (in UI batch) |
| C04 | Partial | Readiness gate (delegates to editor checklist), snapshot, pending pointer, failed build retains last good, retry, stale callback ignored; publication-scoped export | GitHub dispatch and SWA deploy not run live |
| C05 | Met | Accent contrast (real luminance), currency lock, launch-ready checklist | Legal pages stored as paths only |
| M01 | Partial | Server-derived keys, MIME/size/quota, finalize state machine, signature check, rejection deletes blob | Azure SAS behaviour and codec checks not verified live |
| M02 | Met | Other customer, revoked, draft, pinned-after-purchase denied | No download audit log |
| M03 | Partial | Playback and caption links (15 min), revoked refresh denied, resume returned | MP4 H.264/AAC check not implemented (ftyp box only) |
| M04 | Met | Quota, usage, confirm-gated cleanup never removes ready or referenced assets | No malware scanning evaluation written |
| I01 | Partial | Bicep template written; account-key SAS scoped to one blob | Bicep build not verified (CLI bicep install denied) |
| S01 | Met (browser) | Tokens, shells, primitives, lazy studio chunk, 87 KB gzip entry, screenshots at 360/768/1440 | — |
| S02 | Partial | Catalog grid, filters, build plugin for product pages, sitemap | 404 override for unknown slugs not confirmed on SWA |
| S03 | Partial | Product page with outline, purchase states, idempotent checkout start | Prerequisites and tax copy not in API data |
| S04 | Met (browser) | Return page observes state only; polling backs off and stops | Real Stripe redirect not run |
| S05 | Not started | — | Responsive polish pass across all flows |
| P01 | Met (test mode pending) | Server price, success URL, launch gate, idempotency key reuse, field-level key-reuse error | Live Stripe test-mode call not run |
| P02 | Met | Offline SDK signature check on raw bytes, duplicate and concurrent deliveries, amount mismatch recorded, unpaid retried | Live webhook delivery not run |
| P03 | Met | Partial vs full refund, out-of-order refund retried, dispute suspend/restore/revoke, grant-scoped revocation | — |
| P04 | Met | Email-confirmed free claim, single grant (database index), paid product never sent | — |
| P05 | Partial | Buyer receipts without provider IDs; session reconciliation repairs missed webhooks | Refund and dispute reconciliation not implemented |
| L01 | Met (API) | Library with revoked state; cross-customer isolation | UI in batch |
| L02 | Met (API) | Curriculum and lesson access, playback by track | UI in batch |
| L03 | Met (API) | Bounded resume, explicit completion never auto-cleared | UI in batch ("Saved" only after success) |
| L04 | Met (API) | Export, revoke all sessions, self-erase with confirmation, downloads | UI in batch |
| O01 | Met (API) | Overview with launch checklist; product preview and publish | UI in batch |
| O02 | Met (API) | Keyset-paged orders, order detail, customers, failed emails, failed webhooks | UI in batch |
| O03 | Met (API) | Complimentary grant once per product, revoke complimentary only, audited | UI in batch |
| O04 | Met (API) | Audit listing, retention windows, erasure keeps orders | UI in batch |

Not claimed anywhere in this ledger: live payments, live email delivery, live blob storage, GitHub publication, a real screen reader pass, or any production deployment.
