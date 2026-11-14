# Research and scope decisions

Reviewed 2026-11-14. These are product references, not a claim of feature parity or a copy of Teachable's branding.

| Reference | Observed capability | Pagelet decision |
| --- | --- | --- |
| [Teachable courses](https://www.teachable.com/online-courses) | Structured online learning products | Video/text lessons, curriculum, previews, saved progress in core |
| [Teachable digital downloads](https://www.teachable.com/digital-downloads) | Ebooks, PDFs, templates, and other downloadable products | Standalone downloads and course attachments in core |
| [Teachable student experience](https://www.teachable.com/student-experience) | Learning experience and student engagement tools | Responsive library/player in core; quizzes and certificates later |
| [Teachable features](https://www.teachable.com/features) | Coupons, drip lessons, marketing tools, video hosting, SEO | SEO in core; coupons/drip later; affiliates and cart automation excluded |
| [Teachable product overview](https://www.teachable.com/products) | Courses, downloads, memberships, coaching | Courses/downloads fit this small shop; recurring memberships/coaching excluded |

The valuable simplification is one owner, one curated shop, and an understandable purchase-to-learning flow. Large-platform payment plans, marketplace administration, and automated marketing would add complexity and ongoing service cost before the core product is proven.

## Platform findings

- [SWA plans](https://learn.microsoft.com/en-us/azure/static-web-apps/plans) and [pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/static/) distinguish Free personal/pilot hosting from Standard production hosting with an SLA. Free quotas can stop service; a low bill is not a guaranteed free production service.
- [Managed Functions](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions) have HTTP-only triggers and lack managed identity and Key Vault references. [API constraints](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-overview) include a 45-second request limit. These shape direct uploads and the outbox recovery plan.
- [Supported runtimes](https://learn.microsoft.com/en-us/azure/static-web-apps/languages-runtimes) include `node:22`. Pin it in the scaffold and recheck support before deployment.
- [Neon pricing](https://neon.com/pricing) offers PostgreSQL scale-to-zero and pooling; its free storage/restore limits must be checked against the actual workload. Use it as a candidate, not an assumption of unlimited free data retention.
- [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment) requires server-side handling that tolerates repeat calls; a browser redirect is not reliable fulfillment. Pagelet will verify webhooks and atomically record access.
- [Azure Blob SAS](https://learn.microsoft.com/en-us/azure/storage/blobs/sas-service-create-javascript) can scope temporary access to a particular blob. Prefer delegation credentials when supported; the managed SWA tier requires an explicit credential/rotation tradeoff.

## Decisions to validate during implementation

Actual regional quotes, PostgreSQL pool behavior under cold starts, runtime deployment, owner identity propagation, customer cookies, streaming Range requests and URL refresh, publish-triggered static regeneration, transactional email delivery, and a realistic restore exercise. Each is tracked in a specific backlog story; none is assumed complete by this research.
