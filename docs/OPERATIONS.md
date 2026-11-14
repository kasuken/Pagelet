# Operations guide (living)

Scope: one installation, one owner. These steps assume the Azure layout in `infra/` and a PostgreSQL database reachable from the managed API.

## Configuration (Static Web App application settings)

| Setting | Purpose |
| --- | --- |
| `OWNER_IDENTITY_PROVIDER` | Provider name from the SWA identity (for example `github`). Required for any owner access. |
| `OWNER_USER_ID` | The provider's immutable user ID for the owner. Required for any owner access. |
| `APP_BASE_URL` | Public origin, for example `https://shop.example`. Origin checks and links use it. |
| `DATABASE_URL` | Runtime role only (`pagelet_runtime`). Never the migration role. |
| `MAIL_TRANSPORT` / `MAIL_API_URL` / `MAIL_API_KEY` / `MAIL_FROM` | HTTPS mail provider. `log` is refused on hosted production. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe credentials. Rotate by creating a new key, deploying, then revoking the old one. |
| `PUBLISH_WORKFLOW_URL` / `PUBLISH_TOKEN` | Workflow dispatch URL and a fine-grained token limited to `actions:write` on this repository. |
| `PRIVATE_BLOB_ACCOUNT_URL` / `PRIVATE_BLOB_CONTAINER` / `PRIVATE_BLOB_ACCOUNT_KEY` | Private media container. Key is an app setting only. |
| `MEDIA_QUOTA_BYTES` | Optional storage quota (digits only). |

Managed identity, Key Vault references and private networking are not available in the managed API tier. Use scoped settings and rotate them.

## Owner recovery

Owner access is exactly one configured provider identity. There is no first-login claim and no invitation. To change the owner:

1. Obtain the new owner's immutable user ID from the identity provider's own account settings. Do not derive it from the email address.
2. Update `OWNER_IDENTITY_PROVIDER` and `OWNER_USER_ID` in the application settings through the trusted deployment path.
3. Redeploy, then confirm `GET /api/owner/me` succeeds for the new owner's account and returns `403` for the previous one.

If the settings are missing, every owner endpoint returns `503`. This is intended: it fails closed.

## Sign-in and email

- Sender domain: verify SPF, DKIM and a DMARC policy for `MAIL_FROM` with your provider before going live.
- Login links expire after 15 minutes and are single use. The response never reveals whether an address has an account.
- A failed purchase or access email is kept in the outbox. The owner sees it under `GET /api/owner/emails?status=failed` and can retry it once with `POST /api/owner/emails/{id}/retry`. Retries use the row ID as the provider idempotency key, so a repeat cannot double-send.
- Login and free-claim links are never stored, so they cannot be retried. The customer requests a new link.

## Scheduler tradeoff (HTTP-only)

The managed API tier has no timer or queue triggers. Consequences, all by design in v1:

- Email delivery is attempted synchronously after commit with an 8-second bound. A failure never rolls back a payment or access change.
- Retention, reconciliation and cleanup run only when the owner calls them: `POST /api/owner/retention`, `POST /api/owner/reconciliation`, `POST /api/owner/media/cleanup`.
- A future scheduled worker needs its own architecture and cost decision.

## Retention windows

Enforced by `POST /api/owner/retention`:

| Data | Window |
| --- | --- |
| Expired login and free-claim tokens | Removed one day after expiry |
| Expired or revoked sessions | Removed one day after expiry, or 30 days after revocation |
| Rate-limit counters | Removed one day after the window |
| Sent emails | 365 days |
| Processed webhook events | 400 days |
| Orders, refunds, grants, audit events | Kept (legal and financial record) |

## Erasure

`POST /api/owner/customers/{id}/erase` (owner) or `POST /api/me/erase` (customer, with `"confirm":"DELETE"`) removes the identifying email from the customer row, sessions, tokens and outbox rows. Order and payment records are kept with the identity removed.

## Payments

- Webhooks are verified against the raw body. Subscribe to: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `refund.created`, `charge.dispute.created`, `charge.dispute.closed`.
- Stripe redelivers any non-2xx response. Out-of-order refunds are retried until the paid checkout has been recorded.
- Run `POST /api/owner/reconciliation` after a provider outage. It repairs missed sessions without duplicating orders.
- Failed mismatches (wrong amount or currency) appear under `GET /api/owner/webhooks`. Investigate them in the Stripe dashboard before any manual action.

## Backups and rollback

Backup and restoration rehearsal (I04) is not yet implemented. Until it is, take a provider snapshot before each migration and keep the previous SWA deployment available for rollback.
