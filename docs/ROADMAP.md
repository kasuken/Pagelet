# Delivery roadmap

11 epics and 48 child stories. Implementation of E01–E08 is **in progress on the feature branch**; see the ledger in [VERIFICATION](VERIFICATION.md) for what is met, partial, or waiting on a live environment. GitHub publication is a separate step; see [setup](GITHUB_SETUP.md).

Stable keys identify stories independently of GitHub numbers. Each story has scope, acceptance criteria, verification, dependencies, priority, and size in [backlog.json](backlog.json). P0 blocks safe release; P1 is normal planned scope. S/M/L are relative sizes, not delivery promises.

## Sequence

1. F01 proves Azure/runtime/database feasibility. F02/F03/F04 and I01 establish the foundation.
2. Identity and direct media delivery enable authoring; the design system can proceed after the scaffold.
3. Catalog, checkout and fulfillment enable the library and owner support flows.
4. Publication, operations, backup rehearsal and UI polish converge before launch verification.
5. M3 is the core release gate. M4 features begin after Q04; defer them without delaying v1.

Dependencies are story-level and acyclic. Milestones describe outcomes rather than a rigid waterfall: backup/operations work in M1 can run alongside feature development.

## E01 · Foundation and Azure feasibility

Prove the low-cost architecture and establish a reproducible development workflow.

Milestone: M1 · Foundation

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| F01 | Prove SWA managed Functions and PostgreSQL on Azure | P0 | L | — |
| F02 | Scaffold the static web app, HTTP API, and local environment | P0 | M | F01 |
| F03 | Create PostgreSQL schema and migration workflow | P0 | L | F02 |
| F04 | Establish CI checks and API conventions | P0 | M | F02 |

## E02 · Owner identity and customer access

Give one owner control and customers secure access to their purchases.

Milestone: M2 · Core product

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| A01 | Enforce exactly one configured owner | P0 | M | F01, F03, F04 |
| A02 | Implement passwordless customer sign-in and recovery | P0 | L | F03, F04 |
| A03 | Centralize customer entitlement checks | P0 | M | A01, A02, F03 |
| A04 | Add transactional access email and delivery recovery | P0 | M | A01, A02, F03 |

## E03 · Product and course authoring

Let the owner create and safely publish useful learning products.

Milestone: M2 · Core product

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| C01 | Build the product catalog model and editor | P1 | L | A01, F03 |
| C02 | Build the curriculum and lesson editor | P1 | L | C01, M01, M02 |
| C03 | Build the digital-download product editor | P1 | M | C01, M01, M02 |
| C04 | Implement draft preview and atomic publication | P0 | L | C02, C03, S02, I01 |
| C05 | Add shop branding, creator profile and legal settings | P1 | M | A01, C01 |

## E04 · Private files and video delivery

Deliver large media without routing bytes through managed Functions.

Milestone: M2 · Core product

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| M01 | Implement owner-only direct uploads | P0 | L | A01, F03, I01 |
| M02 | Implement authorized file delivery and versioning | P0 | M | A03, M01 |
| M03 | Deliver protected video with captions and resume | P1 | L | M02 |
| M04 | Expose media quotas and safe lifecycle maintenance | P1 | M | M01, M02 |

## E05 · Distinctive storefront and design system

Give creators a polished, fast, accessible shop with a recognizable visual identity.

Milestone: M2 · Core product

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| S01 | Implement the Pagelet design system and app shells | P1 | L | F02 |
| S02 | Build the public catalog and static product export | P1 | L | C01, S01 |
| S03 | Build course and download product detail pages | P1 | M | S02, C05, A03 |
| S04 | Build checkout return and access-recovery screens | P0 | M | S01, P02, A02 |
| S05 | Review and polish all responsive customer and owner flows | P1 | L | S03, S04, L04, O03 |

## E06 · Payments and reliable fulfillment

Turn verified payments into correct, auditable customer access.

Milestone: M2 · Core product

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| P01 | Create server-priced Stripe Checkout sessions | P0 | L | C01, C05, F03, F04 |
| P02 | Implement signed idempotent payment fulfillment | P0 | L | P01, A03, A04 |
| P03 | Synchronize refunds and disputes with access | P0 | L | P02 |
| P04 | Implement verified free-product claims | P1 | M | A03, C01, P02 |
| P05 | Implement receipts and payment reconciliation | P0 | L | P03, A04 |

## E07 · Customer library and learning experience

Make purchased knowledge pleasant to use and easy to resume.

Milestone: M2 · Core product

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| L01 | Build the customer purchase library | P1 | M | A03, P02, S01 |
| L02 | Build the lesson workspace and curriculum navigation | P1 | L | L01, C02, M03 |
| L03 | Persist progress and safe video resume | P1 | M | L02, A03 |
| L04 | Build downloads and customer account controls | P1 | M | L01, M02, P05 |

## E08 · Single-owner shop operations

Give one owner the controls needed to run a real shop.

Milestone: M2 · Core product

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| O01 | Build the owner overview and product workspace | P1 | M | S01, C04, P03 |
| O02 | Build order and customer support views | P1 | M | P05, O01 |
| O03 | Add complimentary access and revocation controls | P1 | M | O02, A04, A03 |
| O04 | Define privacy, retention and operational audit controls | P0 | M | A02, P05, O02 |

## E09 · Deployment, cost controls and recovery

Make an installation reproducible, observable and recoverable.

Milestone: M1 · Foundation

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| I01 | Define SWA and private storage infrastructure | P0 | L | F01, F02 |
| I02 | Automate build, migration and SWA deployment | P0 | L | F04, F03, I01 |
| I03 | Add health, cost and exception observability | P0 | M | I02, F04 |
| I04 | Implement backups and rehearse restoration | P0 | L | I02, F03 |

## E10 · Launch verification and owner onboarding

Deliver a tested product that an independent owner can install and run.

Milestone: M3 · Launch

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| Q01 | Verify purchase-to-learning and refund journeys end to end | P0 | L | S04, L04, O03, P04, P05, I02 |
| Q02 | Audit accessibility, security and performance | P0 | L | S05, Q01, O04, I03 |
| Q03 | Write and test the installation and operations guide | P0 | L | Q01, I04, C05, I03 |
| Q04 | Complete the v1 release checklist and live-readiness review | P0 | S | Q02, Q03 |

## E11 · Focused learning and sales enhancements

Add the most useful Teachable-inspired capabilities after the core shop works.

Milestone: M4 · Enhancements

| Key | Story | Priority | Size | Depends on |
| --- | --- | --- | --- | --- |
| G01 | Add coupons with enforceable limits | P1 | M | Q04, P01, P02 |
| G02 | Add fixed-price course and download bundles | P1 | L | Q04, P03, C01 |
| G03 | Add simple lesson quizzes | P1 | M | Q04, C02, L03 |
| G04 | Add verifiable completion certificates | P1 | M | G03, L03, C05 |
| G05 | Add timezone-aware drip lessons | P1 | M | Q04, A03, L02 |

## Definition of done

Acceptance criteria pass, relevant verification has evidence, docs reflect behavior, and the result is reviewable. All issue states remain open until implementation is verified. A checklist link is not a native GitHub sub-issue; the publisher explicitly creates and verifies parent/child relations.
