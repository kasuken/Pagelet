import { app, type HttpMethod, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { apiHandler, readJson, requireSameOrigin, validate, type Ctx, type Result } from '../core/http.js';
import { getDeps } from '../core/deps.js';
import { apiErrors } from '../core/errors.js';
import { requireOwner } from '../auth/owner.js';
import { Slug, Uuid } from '@pagelet/contracts';
import { publicCatalog, publicProduct, catalogForPublication } from '../services/storefront.js';
import { requestPublication, retryPublication, recordResult } from '../services/publication.js';

const config = () => getDeps().config;
interface Def {
  methods: HttpMethod[];
  route: string;
  handler: (request: HttpRequest, invocation: InvocationContext) => Promise<HttpResponseInit>;
}
const def = (method: HttpMethod, route: string, fn: (ctx: Ctx) => Promise<Result>): Def => ({ methods: [method], route, handler: apiHandler(config, fn, { route }) });
const PUBLIC_CACHE_SECONDS = 60;

const CallbackBody = z.object({
  outcome: z.enum(['succeeded', 'failed']),
  buildUrl: z.url().max(500).nullable().optional(),
  error: z.string().max(500).nullable().optional(),
});

/** Constant-time comparison of the callback bearer token. Refuses everything when no token is configured. */
function callbackAuthorized(request: HttpRequest): boolean {
  const expected = getDeps().config.env.PUBLISH_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const storefrontRoutes: Record<string, Def> = {
  // Public shop profile: display fields and legal page paths only. Seller identity fields stay in owner settings.
  'shop-public': def('GET', 'shop', async () => {
    const { rows } = await getDeps().db().query(
      `SELECT s.shop_name, s.creator_name, s.creator_bio, s.introduction, s.accent_hex, s.currency, s.contact_links, s.legal_pages,
              s.tax_mode, p.slug AS featured_slug
         FROM shop_settings s LEFT JOIN products p ON p.id = s.featured_product_id AND p.status = 'published'
        WHERE s.id = 1`,
    );
    const s = rows[0];
    if (!s) throw apiErrors.notFound();
    return {
      cache: 'public',
      publicMaxAgeSeconds: PUBLIC_CACHE_SECONDS,
      body: {
        shopName: s.shop_name,
        creator: { name: s.creator_name, bio: s.creator_bio },
        introduction: s.introduction,
        accentHex: s.accent_hex,
        currency: s.currency,
        featuredSlug: s.featured_slug ?? null,
        taxMode: s.tax_mode,
        contactLinks: s.contact_links ?? [],
        legal: { terms: s.legal_pages?.terms ?? null, privacy: s.legal_pages?.privacy ?? null, refund: s.legal_pages?.refund ?? null },
      },
    };
  }),

  'catalog-public': def('GET', 'catalog', async () => {
    const items = await publicCatalog(getDeps().db());
    return { cache: 'public', publicMaxAgeSeconds: PUBLIC_CACHE_SECONDS, body: { items } };
  }),

  'catalog-product': def('GET', 'catalog/{slug}', async (ctx) => {
    const slug = validate(Slug, (ctx.request.params as Record<string, string>).slug);
    return { cache: 'public', publicMaxAgeSeconds: PUBLIC_CACHE_SECONDS, body: await publicProduct(getDeps().db(), slug) };
  }),

  'owner-product-preview': def('GET', 'owner/products/{productId}/preview', async (ctx) => {
    requireOwner(ctx.request, config());
    const productId = validate(Uuid, (ctx.request.params as Record<string, string>).productId);
    const { rows } = await getDeps().db().query(
      `SELECT id, slug, product_type, status, title, description, outcomes, price_minor, published_version, revision FROM products WHERE id = $1`,
      [productId],
    );
    if (!rows[0]) throw apiErrors.notFound();
    const sections = await getDeps().db().query(
      `SELECT s.id, s.title, s.position FROM sections s WHERE s.product_id = $1 ORDER BY s.position`,
      [productId],
    );
    const lessons = await getDeps().db().query(
      `SELECT l.id, l.section_id, l.title, l.kind, l.is_preview, l.position FROM lessons l WHERE l.product_id = $1 ORDER BY l.position`,
      [productId],
    );
    const p = rows[0];
    return {
      cache: 'private',
      body: {
        product: { id: p.id, slug: p.slug, type: p.product_type, status: p.status, title: p.title, description: p.description, outcomes: p.outcomes, priceMinor: p.price_minor, revision: p.revision, publishedVersion: p.published_version },
        sections: sections.rows.map((s) => ({ id: s.id, title: s.title, lessons: lessons.rows.filter((l) => l.section_id === s.id).map((l) => ({ id: l.id, title: l.title, kind: l.kind, preview: l.is_preview })) })),
        // Owner preview shows drafts; it is never served publicly.
        audience: 'owner',
      },
    };
  }),

  'owner-product-publish': def('POST', 'owner/products/{productId}/publish', async (ctx) => {
    const owner = requireOwner(ctx.request, config());
    requireSameOrigin(ctx);
    const productId = validate(Uuid, (ctx.request.params as Record<string, string>).productId);
    const result = await requestPublication(getDeps(), ctx.log, { productId, reason: 'publish', actor: `owner:${owner.userId}` });
    return { status: 202, cache: 'private', body: result };
  }),

  'owner-product-archive': def('POST', 'owner/products/{productId}/archive', async (ctx) => {
    const owner = requireOwner(ctx.request, config());
    requireSameOrigin(ctx);
    const productId = validate(Uuid, (ctx.request.params as Record<string, string>).productId);
    const result = await requestPublication(getDeps(), ctx.log, { productId, reason: 'archive', actor: `owner:${owner.userId}` });
    return { status: 202, cache: 'private', body: result };
  }),

  'owner-publication-retry': def('POST', 'owner/publications/{publicationId}/retry', async (ctx) => {
    const owner = requireOwner(ctx.request, config());
    requireSameOrigin(ctx);
    const publicationId = validate(Uuid, (ctx.request.params as Record<string, string>).publicationId);
    return { cache: 'private', body: await retryPublication(getDeps(), ctx.log, publicationId, `owner:${owner.userId}`) };
  }),

  // Build input: the catalog as it will look once this publication succeeds. Bearer-protected, never public.
  'publication-catalog': def('GET', 'internal/publications/{publicationId}/catalog', async (ctx) => {
    if (!callbackAuthorized(ctx.request)) throw apiErrors.unauthorized('Publication credential is not valid.');
    const publicationId = validate(Uuid, (ctx.request.params as Record<string, string>).publicationId);
    return { cache: 'none', body: await catalogForPublication(getDeps().db(), publicationId) };
  }),

  'publication-result': def('POST', 'internal/publications/{publicationId}/result', async (ctx) => {
    if (!callbackAuthorized(ctx.request)) throw apiErrors.unauthorized('Publication callback credential is not valid.');
    const publicationId = validate(Uuid, (ctx.request.params as Record<string, string>).publicationId);
    const body = await readJson(ctx.request, CallbackBody);
    const result = await recordResult(getDeps().db(), { publicationId, outcome: body.outcome, buildUrl: body.buildUrl ?? null, error: body.error ?? null });
    return { cache: 'none', body: result };
  }),
};

for (const [name, d] of Object.entries(storefrontRoutes)) {
  app.http(name, { authLevel: 'anonymous', methods: d.methods, route: d.route, handler: d.handler });
}
