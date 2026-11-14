import { app, type HttpMethod, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { apiHandler, readJson, requireSameOrigin, validate, type Ctx, type Result } from '../core/http.js';
import { getDeps } from '../core/deps.js';
import { apiErrors } from '../core/errors.js';
import { requireOwner } from '../auth/owner.js';
import {
  ProductCreate, ProductUpdate, RevisionQuery, SectionCreate, SectionUpdate, ReorderRequest,
  LessonCreate, LessonUpdate, ShopUpdate, UploadRequest, CleanupRequest, Uuid,
} from '@pagelet/contracts';
import {
  createLesson, createProduct, createSection, deleteLesson, deleteProduct, deleteSection, getProduct,
  listProducts, reorderLessons, reorderSections, updateLesson, updateProduct, updateSection, type ProductStatus,
} from '../services/catalog.js';
import { deleteAsset, abortUpload, finalizeUpload, issueUpload, mediaUsage, runCleanup } from '../services/media.js';
import { getShop, updateShop } from '../services/shop.js';

const config = () => getDeps().config;
const blobFor = () => getDeps().blob();

/**
 * Every owner route: requireOwner first (anonymous 401, other identities 403, unconfigured 503), then, for
 * mutations, the same-origin check. Owner identity is never inferred from a customer session.
 */
const ownerRoute = (route: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', fn: (ctx: Ctx) => Promise<Result>) => ({
  methods: [method] as HttpMethod[],
  route,
  handler: apiHandler(
    config,
    async (ctx) => {
      requireOwner(ctx.request, ctx.config);
      if (method !== 'GET') requireSameOrigin(ctx);
      return fn(ctx);
    },
    { route },
  ),
});

function idParam(request: HttpRequest, name = 'id'): string {
  const raw = request.params?.[name] ?? '';
  const parsed = Uuid.safeParse(raw);
  if (!parsed.success) throw apiErrors.notFound();
  return parsed.data;
}

function revisionFromQuery(request: HttpRequest): number {
  const parsed = validate(RevisionQuery, { revision: request.query.get('revision') ?? undefined });
  return Number(parsed.revision);
}

const PRODUCT_STATUSES = new Set<string>(['draft', 'published', 'archived']);

interface Def {
  methods: HttpMethod[];
  route: string;
  handler: (request: HttpRequest, invocation: InvocationContext) => Promise<HttpResponseInit>;
}
const table: Array<{ name: string; def: Def }> = [];
const add = (name: string, def: Def) => table.push({ name, def });

// ---- Products (C01) -------------------------------------------------------------
add('owner-products-list', ownerRoute('owner/products', 'GET', async (ctx) => {
  const status = ctx.request.query.get('status') ?? undefined;
  if (status !== undefined && !PRODUCT_STATUSES.has(status)) throw apiErrors.validation([{ path: 'status', message: 'Use draft, published or archived.' }]);
  const products = await listProducts(getDeps().db(), status as ProductStatus | undefined);
  return { cache: 'private', body: { products } };
}));

add('owner-products-create', ownerRoute('owner/products', 'POST', async (ctx) => {
  const body = await readJson(ctx.request, ProductCreate);
  const product = await createProduct(getDeps().db(), body, 'owner');
  return { status: 201, cache: 'private', body: { product } };
}));

add('owner-product-get', ownerRoute('owner/products/{id}', 'GET', async (ctx) => {
  const product = await getProduct(getDeps().db(), idParam(ctx.request));
  return { cache: 'private', body: { product } };
}));

add('owner-product-update', ownerRoute('owner/products/{id}', 'PATCH', async (ctx) => {
  const id = idParam(ctx.request);
  const body = await readJson(ctx.request, ProductUpdate);
  await updateProduct(getDeps().db(), id, body, 'owner');
  return { cache: 'private', body: { product: await getProduct(getDeps().db(), id) } };
}));

add('owner-product-delete', ownerRoute('owner/products/{id}', 'DELETE', async (ctx) => {
  const id = idParam(ctx.request);
  await deleteProduct(getDeps().db(), id, revisionFromQuery(ctx.request), blobFor, 'owner');
  return { cache: 'private' };
}));



// ---- Curriculum (C02) -------------------------------------------------------------
add('owner-section-create', ownerRoute('owner/products/{id}/sections', 'POST', async (ctx) => {
  const id = idParam(ctx.request);
  const body = await readJson(ctx.request, SectionCreate);
  const section = await createSection(getDeps().db(), id, body.title, 'owner');
  return { status: 201, cache: 'private', body: { section } };
}));

add('owner-sections-reorder', ownerRoute('owner/products/{id}/sections/reorder', 'POST', async (ctx) => {
  const id = idParam(ctx.request);
  const body = await readJson(ctx.request, ReorderRequest);
  await reorderSections(getDeps().db(), id, body.ids, 'owner');
  return { cache: 'private', body: { product: await getProduct(getDeps().db(), id) } };
}));

add('owner-section-update', ownerRoute('owner/sections/{id}', 'PATCH', async (ctx) => {
  const id = idParam(ctx.request);
  const body = await readJson(ctx.request, SectionUpdate);
  const section = await updateSection(getDeps().db(), id, body.title, 'owner');
  return { cache: 'private', body: { section } };
}));

add('owner-section-delete', ownerRoute('owner/sections/{id}', 'DELETE', async (ctx) => {
  await deleteSection(getDeps().db(), idParam(ctx.request), 'owner');
  return { cache: 'private' };
}));

add('owner-lesson-create', ownerRoute('owner/sections/{id}/lessons', 'POST', async (ctx) => {
  const id = idParam(ctx.request);
  const body = await readJson(ctx.request, LessonCreate);
  const lesson = await createLesson(getDeps().db(), id, body, 'owner');
  return { status: 201, cache: 'private', body: { lesson } };
}));

add('owner-lessons-reorder', ownerRoute('owner/sections/{id}/lessons/reorder', 'POST', async (ctx) => {
  const id = idParam(ctx.request);
  const body = await readJson(ctx.request, ReorderRequest);
  await reorderLessons(getDeps().db(), id, body.ids, 'owner');
  return { cache: 'private', body: { ok: true } };
}));

add('owner-lesson-update', ownerRoute('owner/lessons/{id}', 'PATCH', async (ctx) => {
  const id = idParam(ctx.request);
  const body = await readJson(ctx.request, LessonUpdate);
  const lesson = await updateLesson(getDeps().db(), id, body, 'owner');
  return { cache: 'private', body: { lesson } };
}));

add('owner-lesson-delete', ownerRoute('owner/lessons/{id}', 'DELETE', async (ctx) => {
  await deleteLesson(getDeps().db(), idParam(ctx.request), 'owner');
  return { cache: 'private' };
}));

// ---- Shop settings (C05) ----------------------------------------------------------
add('owner-shop-get', ownerRoute('owner/shop', 'GET', async () => {
  return { cache: 'private', body: await getShop(getDeps().db()) };
}));

add('owner-shop-update', ownerRoute('owner/shop', 'PATCH', async (ctx) => {
  const body = await readJson(ctx.request, ShopUpdate);
  return { cache: 'private', body: await updateShop(getDeps().db(), body, 'owner') };
}));

// ---- Media (M01, M02, M04) ------------------------------------------------------------
add('owner-upload-create', ownerRoute('owner/media/uploads', 'POST', async (ctx) => {
  const body = await readJson(ctx.request, UploadRequest);
  const result = await issueUpload(getDeps().db(), blobFor(), config(), {
    kind: body.kind,
    productId: body.productId,
    mimeType: body.mimeType,
    declaredBytes: body.declaredBytes,
    versionLabel: body.versionLabel,
    replacesAssetId: body.replacesAssetId,
  }, 'owner');
  return { status: 201, cache: 'private', body: result };
}));

add('owner-upload-finalize', ownerRoute('owner/media/uploads/{id}/finalize', 'POST', async (ctx) => {
  const asset = await finalizeUpload(getDeps().db(), blobFor(), config(), idParam(ctx.request), 'owner');
  return { cache: 'private', body: { asset } };
}));

add('owner-upload-abort', ownerRoute('owner/media/uploads/{id}', 'DELETE', async (ctx) => {
  await abortUpload(getDeps().db(), blobFor(), idParam(ctx.request), 'owner');
  return { cache: 'private' };
}));

add('owner-asset-delete', ownerRoute('owner/media/assets/{id}', 'DELETE', async (ctx) => {
  await deleteAsset(getDeps().db(), blobFor(), idParam(ctx.request), 'owner');
  return { cache: 'private' };
}));

add('owner-media-usage', ownerRoute('owner/media/usage', 'GET', async () => {
  return { cache: 'private', body: await mediaUsage(getDeps().db(), config()) };
}));

add('owner-media-cleanup', ownerRoute('owner/media/cleanup', 'POST', async (ctx) => {
  const body = await readJson(ctx.request, CleanupRequest);
  return { cache: 'private', body: await runCleanup(getDeps().db(), blobFor(), body.olderThanHours, 'owner') };
}));

/** Every owner catalog route, keyed by function name. Tests call these handlers directly. */
export const catalogRoutes = Object.fromEntries(table.map(({ name, def }) => [name, def]));

for (const { name, def } of table) {
  app.http(name, { authLevel: 'anonymous', methods: def.methods, route: def.route, handler: def.handler });
}
