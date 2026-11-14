/// <reference types="node" />
// Build-time static export: crawlable product pages, sitemap and robots rules generated from the
// public catalog export (scripts/export-public-catalog.mjs writes public/catalog/catalog.json).
// Only fields from the public API are read; anything else in the file is ignored.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CURRENCY = /^[A-Z]{3}$/;
const PRIVATE_PATHS = ['/library', '/learn/', '/account/', '/checkout/', '/studio', '/api/'];

export interface ExportProduct {
  slug: string;
  productType: 'course' | 'download';
  title: string;
  description: string;
  outcomes: string[];
  price: { amountMinor: number; currency: string };
  sections: Array<{ title: string; lessons: Array<{ title: string; kind: string; preview: boolean }> }>;
}

export interface ExportShop {
  shopName: string;
  introduction: string | null;
  creator: { name: string | null };
}

export interface CatalogExport {
  shop: ExportShop;
  items: ExportProduct[];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON that is safe inside a <script> element. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function str(value: unknown, max = 20_000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Keeps only well-formed public products and only their public fields. */
export function sanitizeExport(raw: unknown): CatalogExport {
  const data = (raw ?? {}) as { shop?: Record<string, unknown>; items?: unknown[] };
  const shop = data.shop ?? {};
  const creator = (shop.creator ?? {}) as Record<string, unknown>;
  const items: ExportProduct[] = [];
  for (const entry of Array.isArray(data.items) ? data.items : []) {
    const p = (entry ?? {}) as Record<string, unknown>;
    const price = (p.price ?? {}) as Record<string, unknown>;
    const slug = str(p.slug, 80);
    if (!SLUG.test(slug)) continue;
    if (p.productType !== 'course' && p.productType !== 'download') continue;
    if (typeof price.amountMinor !== 'number' || !Number.isInteger(price.amountMinor) || price.amountMinor < 0) continue;
    if (typeof price.currency !== 'string' || !CURRENCY.test(price.currency)) continue;
    items.push({
      slug,
      productType: p.productType,
      title: str(p.title, 300) || slug,
      description: str(p.description),
      outcomes: (Array.isArray(p.outcomes) ? p.outcomes : []).map((o) => str(o, 300)).filter(Boolean),
      price: { amountMinor: price.amountMinor, currency: price.currency },
      sections: (Array.isArray(p.sections) ? p.sections : []).map((s) => {
        const section = (s ?? {}) as Record<string, unknown>;
        return {
          title: str(section.title, 300),
          lessons: (Array.isArray(section.lessons) ? section.lessons : []).map((l) => {
            const lesson = (l ?? {}) as Record<string, unknown>;
            return { title: str(lesson.title, 300), kind: lesson.kind === 'video' ? 'video' : 'text', preview: lesson.preview === true };
          }),
        };
      }),
    });
  }
  return {
    shop: {
      shopName: str(shop.shopName, 120) || 'Shop',
      introduction: str(shop.introduction, 2000) || null,
      creator: { name: str(creator.name, 120) || null },
    },
    items,
  };
}

function fractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function decimalPrice(price: { amountMinor: number; currency: string }): string {
  const digits = fractionDigits(price.currency);
  return (price.amountMinor / 10 ** digits).toFixed(digits);
}

export function displayPrice(price: { amountMinor: number; currency: string }): string {
  if (price.amountMinor === 0) return 'Free';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: price.currency }).format(Number(decimalPrice(price)));
  } catch {
    return `${decimalPrice(price)} ${price.currency}`;
  }
}

function summary(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function injectHead(template: string, head: string): string {
  return template.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta name="description"[^>]*>/, '').replace('</head>', `${head}\n  </head>`);
}

function injectRoot(template: string, html: string): string {
  return template.replace('<div id="root"></div>', `<div id="root">${html}</div>`);
}

export function productHead(product: ExportProduct, shop: ExportShop, origin: string | null): string {
  const title = `${product.title} | ${shop.shopName}`;
  const description = summary(product.description) || `${product.productType === 'course' ? 'Course' : 'Download'} from ${shop.shopName}`;
  const url = origin ? `${origin}/products/${product.slug}` : null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': product.productType === 'course' ? 'Course' : 'Product',
    name: product.title,
    description,
    ...(product.productType === 'course' && shop.creator.name ? { provider: { '@type': 'Person', name: shop.creator.name } } : {}),
    offers: {
      '@type': 'Offer',
      price: decimalPrice(product.price),
      priceCurrency: product.price.currency,
      availability: 'https://schema.org/InStock',
      ...(url ? { url } : {}),
    },
    ...(url ? { url } : {}),
  };
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    url ? `<link rel="canonical" href="${escapeHtml(url)}" />` : '',
    `<meta property="og:type" content="product" />`,
    `<meta property="og:title" content="${escapeHtml(product.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(shop.shopName)}" />`,
    url ? `<meta property="og:url" content="${escapeHtml(url)}" />` : '',
    `<meta name="twitter:card" content="summary" />`,
    `<script type="application/ld+json">${safeJson(jsonLd)}</script>`,
  ]
    .filter(Boolean)
    .map((line) => `    ${line}`)
    .join('\n');
}

/** Plain, crawlable markup. React replaces it when the app starts. */
export function productBody(product: ExportProduct, shop: ExportShop): string {
  const paragraphs = product.description
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');
  const outcomes = product.outcomes.length
    ? `<h2>What you get</h2><ul>${product.outcomes.map((o) => `<li>${escapeHtml(o)}</li>`).join('')}</ul>`
    : '';
  const outline = product.sections.length
    ? `<h2>${product.productType === 'course' ? 'Course outline' : 'What is included'}</h2><ol>${product.sections
        .map((s) => `<li>${escapeHtml(s.title)}${s.lessons.length ? `<ol>${s.lessons.map((l) => `<li>${escapeHtml(l.title)}</li>`).join('')}</ol>` : ''}</li>`)
        .join('')}</ol>`
    : '';
  return (
    `<div class="wrap static-page"><p><a href="/">${escapeHtml(shop.shopName)}</a></p>` +
    `<main><h1>${escapeHtml(product.title)}</h1><p>${escapeHtml(displayPrice(product.price))}</p>${paragraphs}${outcomes}${outline}</main></div>`
  );
}

export function homeNoscript(data: CatalogExport): string {
  if (data.items.length === 0) return '';
  return `<noscript><ul>${data.items
    .map((p) => `<li><a href="/products/${p.slug}">${escapeHtml(p.title)}</a></li>`)
    .join('')}</ul></noscript>`;
}

export function sitemap(origin: string, data: CatalogExport): string {
  const urls = ['/', ...data.items.map((p) => `/products/${p.slug}`)];
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${escapeHtml(origin + u)}</loc></url>`).join('\n') +
    '\n</urlset>\n'
  );
}

export function robots(origin: string | null): string {
  const lines = ['User-agent: *', ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`)];
  if (origin) lines.push(`Sitemap: ${origin}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

export function siteOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.PAGELET_SITE_ORIGIN || env.PUBLIC_API_BASE;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.hostname === 'localhost' ? url.origin : null;
  } catch {
    return null;
  }
}

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function pageletStaticPages(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'pagelet-static-pages',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    closeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      const indexPath = join(outDir, 'index.html');
      if (!existsSync(indexPath)) return;
      const template = readFileSync(indexPath, 'utf8');
      const origin = siteOrigin();
      const catalogPath = join(config.publicDir, 'catalog', 'catalog.json');
      const data = existsSync(catalogPath) ? sanitizeExport(JSON.parse(readFileSync(catalogPath, 'utf8'))) : null;

      write(join(outDir, 'robots.txt'), robots(origin));

      if (!data) {
        config.logger.info('pagelet-static-pages: no public/catalog/catalog.json; skipped product pages and sitemap.');
        return;
      }
      for (const product of data.items) {
        const html = injectRoot(injectHead(template, productHead(product, data.shop, origin)), productBody(product, data.shop));
        write(join(outDir, 'products', product.slug, 'index.html'), html);
      }
      const homeHead = [
        `    <title>${escapeHtml(data.shop.shopName)}</title>`,
        `    <meta name="description" content="${escapeHtml(summary(data.shop.introduction ?? '') || `Courses and downloads from ${data.shop.shopName}`)}" />`,
        origin ? `    <link rel="canonical" href="${escapeHtml(origin)}/" />` : '',
      ]
        .filter(Boolean)
        .join('\n');
      write(indexPath, injectHead(template, homeHead).replace('</body>', `  ${homeNoscript(data)}\n  </body>`));
      if (origin) write(join(outDir, 'sitemap.xml'), sitemap(origin, data));
      else config.logger.warn('pagelet-static-pages: set PAGELET_SITE_ORIGIN (https) to emit canonical URLs and sitemap.xml.');
      config.logger.info(`pagelet-static-pages: wrote ${data.items.length} product page(s).`);
    },
  };
}
