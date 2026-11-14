# Infrastructure (I01, minimal)

`main.bicep` defines one private storage account for owner uploads and published files. It is parameterized and has **not been deployed**.

## What the template creates

- One `StorageV2` account, `Standard_LRS`, `allowBlobPublicAccess: false`, `minimumTlsVersion: TLS1_2`, `supportsHttpsTrafficOnly: true`.
- One private container (`publicAccess: None`), default `private-media`.
- CORS limited to a single `appOrigin` (the Static Web Apps site), for the browser's direct PUT and Range GET only.
- Blob soft delete (default 7 days) for recovery.

It does **not** create Static Web Apps, PostgreSQL or the email provider. Those are prerequisites (below).

## Deploy (when you choose to; not done here)

```sh
az group create -n rg-pagelet-test -l westeurope
az deployment group create -g rg-pagelet-test -f infra/main.bicep \
  -p storageAccountName=pageletmediatest appOrigin=https://<your-swa-host> environment=test
```

Use a separate resource group and account for `production`. Pull request previews must not share the production account or its key.

## Authentication model: account-key, blob-scoped SAS

- The API does not assume managed identity, Key Vault references or private endpoints in the managed Functions tier.
- The API signs **service SAS tokens scoped to one blob** (`sr=b`) with the storage account key. These are not container-wide tokens and not account SAS: an account SAS cannot be restricted to a single blob.
- Upload tokens grant only `cw` (create, write). Read tokens grant only `r`, with a `Content-Disposition: attachment` header. Lifetimes are set per call (15 minutes for uploads and playback, 5 minutes for downloads).
- Limits of SAS: it cannot enforce a maximum size or Content-Type on upload. The API enforces both at finalization (size, MIME and signature checks) and the quota at issuance and finalization. Finalization therefore decides what is kept.

### App settings (set on the Static Web App, never in the browser bundle)

| Setting | Purpose |
| --- | --- |
| `PRIVATE_BLOB_ACCOUNT_URL` | `https://<account>.blob.core.windows.net` |
| `PRIVATE_BLOB_CONTAINER` | defaults to `private-media` |
| `PRIVATE_BLOB_ACCOUNT_KEY` | account key 1 or 2, used only to sign SAS; never logged |
| `MEDIA_QUOTA_BYTES` | optional quota in bytes; defaults to 10 GiB |

### Key rotation

1. Regenerate **key2** in the storage account (`az storage account keys renew -n <account> -g <rg> --key secondary`).
2. Set `PRIVATE_BLOB_ACCOUNT_KEY` to the key2 value and restart or redeploy the app.
3. Confirm uploads and downloads still work, then regenerate **key1**.

Regenerating the key that signs current SAS tokens invalidates them immediately. Expect in-flight uploads to fail and retry. Rotation is manual; there is no scheduled rotation in the managed tier.

`allowSharedKeyAccess` must stay `true` for key-signed SAS. Setting it to `false` breaks the API's upload and download URLs.

## Upload and object lifecycle

- Objects live under server-derived keys: `<kind>/<productId or shop>/<assetId>`. Clients never choose a key.
- A pending upload that is never finalized is removed by `POST /api/owner/media/cleanup` (owner, manual, requires `confirm: true`) after the configured age, together with rejected uploads. The API never removes a ready asset that is referenced by content.
- Rejected finalizations delete their blob at once.

## Verification status

- `az bicep build --file infra/main.bicep`: **not run**. The Bicep CLI was not installed, and installing it was denied in this session. The template is unverified until it builds.
- No deployment, no live storage, no real SAS. The API's SAS construction is unit-tested with mocked clients only (`api/test/blob.test.ts`).

## Not yet defined (I01 scope gaps)

- Static Web Apps resource, plan and region parameters.
- Retention and isolated test/production environments beyond separate deployments.
- A reviewed cost estimate. No figures are given here, so none are invented.
- Blob-level scanning. The posture is validation at finalization, not malware scanning.
