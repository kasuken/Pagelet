# Pagelet working agreement

- One installation, one shop, exactly one owner. Customer identities are purchase/learning identities, not merchant tenants.
- Read docs/PRODUCT.md, docs/ARCHITECTURE.md, and docs/DESIGN.md before implementation.
- The design directory is a fictional interactive prototype, not production commerce.
- Keep the frontend static and the default API inside SWA managed Functions. No timer, queue, Durable Functions, or managed-identity assumptions in that tier.
- Paid content authorization belongs in the API. Never ship paid assets or private data in static output.
- Every payment mutation must be idempotent; never grant access from a success URL alone.
- Use PostgreSQL constraints and transactions for purchase integrity; do not add tenant IDs or staff roles.
- Follow the design tokens and document screenshots for responsive UI changes. Use the frontend-design skill when available.
- Validate the backlog with python3 scripts/validate_backlog.py after planning changes.
- Never mark a GitHub publication successful until the repository metadata, all issues, and native parent/child relations have been verified.
