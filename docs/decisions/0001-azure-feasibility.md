# ADR 0001: Azure feasibility (F01) — status: pending live run

Date: 2026-11-14

## Status

**Not executed live.** The repository holds the code paths and automated checks for the managed API (routes, `/api` 404 contract, health, raw webhook bytes, cookie flags, body limits). No Azure resource has been created by this work. The owner approved a free-tier Static Web App only; the PostgreSQL side needs an account and approval that have not been given.

## What is verified locally

- Managed API runtime: `node:22` is listed as supported for Azure Static Web Apps managed Functions (Functions v4, HTTP triggers only). Source: Microsoft Learn, "Supported languages and runtimes in Azure Static Web Apps", checked 2026-11-14.
- Navigation: `navigationFallback` excludes `/api/*`, and the API catch-all returns JSON 404 (`api/src/functions/routes.ts`, tested in `tests/integration/api-auth.test.ts`).
- Request bodies: read as raw bytes with a bounded reader (`readBoundedBody`). Webhook signatures are verified against those bytes (tested in `tests/integration/payments.test.ts`).
- Cookies: `__Host-pagelet_session`, Secure, HttpOnly, SameSite=Lax, host-only (tested).
- Limits: the managed tier has no timer or queue triggers and no managed identity assumptions. The design avoids both (see `docs/OPERATIONS.md`).

## Live spike result (2026-11-14, free tier, `rg-pagelet-f01-spike`)

- Created one Free-tier Static Web App (`swa-pagelet-f01`, West Europe) with the Azure CLI. Deployed with `swa deploy` (SWA CLI 2.1.0, `--api-language node --api-version 22`).
- **Static content: served.** Deployment reported success, and the site root is reachable.
- **API: not registered.** `GET /api/health` and `GET /api/hello` return `404` after roughly 15 minutes of polling. The management API lists zero functions for the build. The same 404 occurred for a minimal hello-world Functions app (Functions v4, with and without a lockfile).
- **Remote build failure, confirmed locally:** SWA builds `api/` in isolation, and the bundle script could not resolve `@pagelet/contracts` from outside the monorepo. The bundle now runs in CI, and the deploy ships `api/` with the prebuilt `dist/index.js` and the `build` script renamed to `bundle`, so SWA's Oryx step does not run it. This did not fix the 404 seen above, so the cause is still unknown.
- **Not determined:** whether a client-supplied `x-ms-client-principal` reaches the API; which forwarded-IP header SWA sets; whether a `responseOverrides` 404 rewrites API 404s; cold-start timings.
- **Cleanup:** `rg-pagelet-f01-spike` (containing the Static Web App) was deleted with `--no-wait` after these checks. Confirm the deletion finished with `az group show -n rg-pagelet-f01-spike` returning not found.

Next time: read the Oryx build log in the workflow (only available through a GitHub-connected deployment), or use Application Insights, to find why the functions are not created. Do not treat A01's deployed-SWA verification as done until then.

## What remains before this ADR can be accepted

1. Deploy a disposable Free-tier Static Web App with `api/` bundled (`node api/scripts/build.mjs`) and record `GET /api/health`, an unknown `/api/x` (must be JSON 404), and whether a client-supplied `x-ms-client-principal` header is ignored when the request does not come through SWA.
2. Measure cold-start latency for `/api/health` over several idle periods.
3. Pooled PostgreSQL TLS: requires a database account (Neon or Azure PostgreSQL). Record the cost and network decision, and the cleanup steps.
4. Record the exact runtime configuration and the 45-second request limit observed.

Until these are done, no production purchase or private data may be used on this infrastructure.
