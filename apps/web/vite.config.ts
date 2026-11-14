import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { pageletStaticPages } from './build/staticPages';

// The production build contains only apps/web. The design/ prototype is never imported or copied.
export default defineConfig({
  plugins: [react(), pageletStaticPages()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    // Never inline fonts or images as data: URIs; the CSP only allows same-origin fonts.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:7071' },
  },
});
