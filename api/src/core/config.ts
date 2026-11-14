import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  APP_BASE_URL: z.url().optional(),
  DATABASE_URL: z.string().optional(),
  OWNER_IDENTITY_PROVIDER: z.string().min(1).max(40).optional(),
  OWNER_USER_ID: z.string().min(1).max(200).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MAIL_API_URL: z.url().optional(),
  MAIL_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_TRANSPORT: z.enum(['log', 'http']).default('log'),
  PRIVATE_BLOB_ACCOUNT_URL: z.url().optional(),
  PRIVATE_BLOB_CONTAINER: z.string().min(3).max(63).default('private-media'),
  // Account key for SAS signing. An app setting only; never logged, never sent to the browser.
  PRIVATE_BLOB_ACCOUNT_KEY: z.string().min(1).optional(),
  // Per-installation storage quota in bytes (digits only). Defaults to 10 GiB when unset.
  MEDIA_QUOTA_BYTES: z.string().regex(/^[1-9]\d{0,14}$/).optional(),
  PUBLISH_WORKFLOW_URL: z.url().optional(),
  PUBLISH_TOKEN: z.string().optional(),
  // Set by Azure App Service / Static Web Apps hosting. Its presence means production-like hosting.
  WEBSITE_SITE_NAME: z.string().optional(),
});

export interface AppConfig {
  env: z.infer<typeof EnvSchema>;
  /** Owner identity. Undefined when unconfigured; owner endpoints then fail closed. */
  owner?: { provider: string; userId: string };
  appOrigin?: string;
  isHostedProduction: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(source);
  const owner =
    parsed.OWNER_IDENTITY_PROVIDER && parsed.OWNER_USER_ID
      ? { provider: parsed.OWNER_IDENTITY_PROVIDER.toLowerCase(), userId: parsed.OWNER_USER_ID }
      : undefined;
  return {
    env: parsed,
    owner,
    appOrigin: parsed.APP_BASE_URL ? new URL(parsed.APP_BASE_URL).origin : undefined,
    isHostedProduction: Boolean(parsed.WEBSITE_SITE_NAME) || parsed.NODE_ENV === 'production',
  };
}
