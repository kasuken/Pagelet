// Bundles the managed API into one self-contained ES module file (dist/index.js).
// SWA deploys only the api/ folder, so workspace symlinks (@pagelet/contracts) must be inlined here.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  outfile: new URL('../dist/index.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  // Keep runtime packages external; SWA installs them from api/package.json.
  external: ['@azure/functions', 'pg', 'stripe', '@azure/storage-blob'],
  alias: { '@pagelet/contracts': new URL('../../packages/contracts/src/index.ts', import.meta.url).pathname },
  logLevel: 'info',
});
