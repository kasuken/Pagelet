# Cost model

Goal: minimize idle cost and keep growth cost visible. This is a planning model, not a provider quote or a promise of a fixed monthly bill. No paid resources have been created.

| Component | Pilot | Production decision |
| --- | --- | --- |
| Azure Static Web Apps | Free within quota; no SLA | Standard for commercial reliability; quote selected region/currency |
| Managed Functions | Metered/included allowances depend on current plan | Measure calls and duration; keep media traffic off functions |
| PostgreSQL | Evaluate Neon Free for prototype | Paid restore history/storage when handling live orders; compare Azure Flexible Server |
| Azure Blob | Metered stored GB, requests, and egress | Private containers, direct playback, lifecycle/retention limits |
| Email | Provider allowance if suitable | Deliverability, domain authentication, retry visibility, usage cap |
| Stripe | Sandbox during development | Per-transaction fees, optional Tax fees, currency/region-dependent |
| Domain / observability | Existing domain, sampled logs | Renewal cost, bounded log retention, billing alerts |

Monthly total = SWA base + Functions usage + PostgreSQL compute/storage/restore + blob storage/operations/egress + email + logs + domain allocation + payment fees. The storefront fee is only one term.

## Workload examples

Assumptions, not measurements: 20GB uploaded media, an average 2 Mbps playback stream, and 500MB database usage at launch. One viewer-hour at 2 Mbps is approximately **0.9GB** transferred before overhead.

| Scenario | Viewer hours/month | Approximate video transfer |
| --- | ---: | ---: |
| Small pilot | 100 | 90GB |
| Growing shop | 1,000 | 900GB |

This traffic goes to Blob Storage, so it does not become free merely because the frontend fits SWA quotas. Native MP4 avoids transcoding fees but requires pre-encoded files and lacks adaptive bitrate. Compare a dedicated video service when measured delivery cost or playback quality warrants it; do not add one by default.

Before launch, record the selected region, billing currency, dated provider rates, expected orders, watched hours, uploaded GB, retained database history, and email volume. Calculate low/expected/high scenarios in the operations issue. Set alerts at 50%, 80%, and 100% of the owner's configured budget; alerts are not hard spending caps. Define service-level quotas (upload size/count, request rate, signed-URL lifetime, log retention) and an owner-visible response to exceeded quotas.

Free PostgreSQL tiers are not a backup plan. Set a proposed RPO of 24h and RTO of 4h, then verify them with the chosen provider and actual restore rehearsal; tighter order recovery uses provider history plus Stripe reconciliation. Never assert a restore target until tested.

Sources reviewed 2026-11-14: [SWA pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/static/), [SWA quotas](https://learn.microsoft.com/en-us/azure/static-web-apps/quotas), [Neon pricing](https://neon.com/pricing), [Azure Blob pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/). Obtain live region-specific quotes during infrastructure implementation.
