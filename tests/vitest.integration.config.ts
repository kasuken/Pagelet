import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const contracts = fileURLToPath(new URL('../packages/contracts/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@pagelet/contracts': contracts },
  },
  test: {
    include: ['integration/**/*.test.ts'],
    environment: 'node',
    // Each file gets its own database on one embedded server; run files serially to keep startup predictable.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
