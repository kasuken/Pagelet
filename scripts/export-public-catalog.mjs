#!/usr/bin/env node
// Writes the public storefront data for the static build.
//   Reads ONLY the publication-scoped catalog endpoint (bearer PUBLISH_TOKEN), which shows the pending version
//   of this publication, so the site built now is the version being published, not the previous one.
//   Exit code 3 means the publication already succeeded; the workflow then skips the rebuild.
//   Env: PUBLIC_API_BASE (origin), PUBLICATION_ID, PUBLISH_TOKEN, output dir as argv[2].
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = process.argv[2];
const base = process.env.PUBLIC_API_BASE;
const publicationId = process.env.PUBLICATION_ID;
const token = process.env.PUBLISH_TOKEN;
if (!outDir || !base || !publicationId || !token) {
  console.error('Usage: PUBLIC_API_BASE, PUBLICATION_ID and PUBLISH_TOKEN must be set; argv[2] is the output directory.');
  process.exit(2);
}
const origin = new URL(base).origin;
const response = await fetch(new URL(`/api/internal/publications/${encodeURIComponent(publicationId)}/catalog`, origin), {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  console.error(`Catalog export returned HTTP ${response.status}`);
  process.exit(1);
}
const data = await response.json();
if (data.alreadySucceeded) {
  console.log('This publication already succeeded; skipping rebuild.');
  process.exit(3);
}
const payload = { generatedAt: new Date().toISOString(), shop: data.shop, items: data.items };
const text = JSON.stringify(payload, null, 2);
const FORBIDDEN = /object_key|objectKey|sas|signature=|provider_payment|stripe_|sk_live|whsec_|PUBLISH_TOKEN|transcript|body_html/i;
if (FORBIDDEN.test(text)) {
  console.error('Refusing to write: the export contains a private-looking field.');
  process.exit(1);
}
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'catalog.json'), text + '\n');
console.log(`Exported ${data.items.length} public product(s) for publication ${publicationId}.`);
