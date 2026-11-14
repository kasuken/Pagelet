import { loadConfig, type AppConfig } from './config.js';
import { createPool, type Db } from './db.js';
import type { BlobPort, MailPort, PublishPort } from './ports.js';
import { StorageSharedKeyCredential } from '@azure/storage-blob';
import { createAzureBlobPort } from '../services/blob.js';
import { apiErrors } from './errors.js';
import type { PaymentPort } from './payment-port.js';

/** Process-wide dependencies. Created lazily so an unconfigured instance still answers health checks. */
export interface Deps {
  config: AppConfig;
  db(): Db;
  mail: MailPort;
  blob(): BlobPort;
  publish(): PublishPort;
  payments(): PaymentPort;
  now(): Date;
}

let override: Partial<Deps> | undefined;
let base: Deps | undefined;

export function getDeps(): Deps {
  base ??= defaultDeps();
  return override ? { ...base, ...override } : base;
}

/** Test seam: replace ports with fakes. Pass undefined to restore production wiring. */
export function setDepsForTesting(partial: Partial<Deps> | undefined): void {
  override = partial;
}

function defaultDeps(): Deps {
  const config = loadConfig();
  let pool: Db | undefined;
  let blobPort: BlobPort | undefined;
  return {
    config,
    db() {
      if (!config.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
      pool ??= createPool(config.env.DATABASE_URL);
      return pool;
    },
    mail: unconfiguredMail(),
    blob() {
      blobPort ??= configuredBlob(config);
      return blobPort;
    },
    publish() {
      throw new Error('Publish trigger is not configured');
    },
    payments() {
      throw new Error('Payments are not configured');
    },
    now: () => new Date(),
  };
}

function unconfiguredMail(): MailPort {
  return {
    async send() {
      throw new Error('Mail transport is not configured');
    },
  };
}

function configuredBlob(config: AppConfig): BlobPort {
  const url = config.env.PRIVATE_BLOB_ACCOUNT_URL;
  const key = config.env.PRIVATE_BLOB_ACCOUNT_KEY;
  if (!url || !key) throw apiErrors.unavailable('Media storage is not configured.');
  const account = new URL(url).hostname.split('.')[0] ?? '';
  return createAzureBlobPort({
    accountUrl: url,
    containerName: config.env.PRIVATE_BLOB_CONTAINER,
    credential: new StorageSharedKeyCredential(account, key),
  });
}
