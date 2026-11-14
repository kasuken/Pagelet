# Pagelet

**Your website. Your products. Your start.**

A small, self-hosted shop for creators who sell video courses, PDFs, templates, and other digital downloads. **One installation. One admin. One shop.**

Pagelet is designed around an inexpensive static frontend, Azure Static Web Apps managed Azure Functions, and PostgreSQL. Customers get a private library; the owner gets a focused publishing and sales workspace.

> **Status: product planning and interactive design prototype.** Payments, authentication, storage, and the production application are not implemented yet. The prototype contains fictional sample products and orders; it never charges anyone.

## Explore the design

Open [design/index.html](design/index.html) in a browser, or serve the repository:

```sh
python3 -m http.server 4173
```

Visit `http://localhost:4173/design/`. Switch between Shop, My learning, and Studio. Product filtering, product details, lesson selection, and a sample completion interaction work locally.

## What we're building

- Branded storefront and useful product pages with course previews.
- Course sections with video, text, transcripts, and downloadable resources.
- Standalone PDFs, ebooks, ZIP templates, workbooks, and audio downloads.
- Stripe-hosted checkout, verified fulfillment, receipts, refunds, and access revocation.
- Passwordless customer access, a purchase library, and saved learning progress.
- One owner dashboard for products, orders, customers, and essential reporting.
- A documented installation, backups, cost monitoring, and an upgrade path.

No multi-tenant control plane, seller marketplace, staff invitations, revenue splitting, or custom video transcoding service. Quizzes, certificates, drip content, bundles, and coupons follow the core release.

## Planned stack

| Layer | Choice |
| --- | --- |
| Frontend | React + TypeScript + Vite, static output |
| Hosting | Azure Static Web Apps |
| API | Managed Azure Functions, TypeScript, Node.js 22 |
| Database | PostgreSQL; pooled connections, SQL migrations |
| Files and video | Private Azure Blob Storage; direct upload and short-lived access URLs |
| Payments | Stripe Checkout and signed webhooks |
| Owner identity | SWA preconfigured identity provider plus one immutable owner ID |
| Customer identity | Email magic links and server-side sessions |
| Delivery | GitHub Actions; Bicep infrastructure |

SWA Free is a pilot option with quotas and no SLA. Budget for SWA Standard for production, plus database, storage, bandwidth, email, and payment processing. See [cost model](docs/COSTS.md). No cloud resources have been provisioned.

## Product and delivery documents

- [Product scope and release criteria](docs/PRODUCT.md)
- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [UI direction and interaction specifications](docs/DESIGN.md)
- [Research and feature decisions](docs/RESEARCH.md)
- [Cost model](docs/COSTS.md)
- [Epics, issues, and delivery sequence](docs/ROADMAP.md)
- [Machine-readable backlog](docs/backlog.json)
- [GitHub publishing instructions](docs/GITHUB_SETUP.md)
- [Verification results and remaining checks](docs/VERIFICATION.md)

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before implementing an issue. Each story includes acceptance criteria, dependencies, and verification expectations. Start with the foundation milestone; later issues depend on its deployment and database decisions.

Validate the planning package with `python3 scripts/validate_backlog.py`. The GitHub publisher defaults to a dry run; publication requires `--apply`.

## License

[MIT](LICENSE). Sample branding and product copy in the prototype are fictional.
