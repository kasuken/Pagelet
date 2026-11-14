import { app, type HttpMethod, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { Slug, Uuid } from '@pagelet/contracts';
import { apiHandler, readJson, requireSameOrigin, validate, type Ctx, type Result } from '../core/http.js';
import { getDeps } from '../core/deps.js';
import { apiErrors } from '../core/errors.js';
import { requireCustomer } from '../auth/session.js';
import { assertProductAccess, assertLessonAccess } from '../services/entitlements.js';
import { issueDownloadUrl, issuePlaybackUrl, recordResumePosition } from '../services/media.js';

const config = () => getDeps().config;
interface Def {
  methods: HttpMethod[];
  route: string;
  handler: (request: HttpRequest, invocation: InvocationContext) => Promise<HttpResponseInit>;
}
const def = (method: HttpMethod, route: string, fn: (ctx: Ctx) => Promise<Result>): Def => ({ methods: [method], route, handler: apiHandler(config, fn, { route }) });
const param = (ctx: Ctx, name: string) => (ctx.request.params as Record<string, string>)[name];

const ProgressBody = z.object({
  resumeSeconds: z.number().int().min(0).max(86_400),
  completed: z.boolean().optional(),
});

export const learningRoutes: Record<string, Def> = {
  'library-curriculum': def('GET', 'library/products/{slug}/curriculum', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const slug = validate(Slug, param(ctx, 'slug'));
    const { rows: product } = await deps.db().query<{ id: string; title: string }>('SELECT id, title FROM products WHERE slug = $1', [slug]);
    if (!product[0]) throw apiErrors.notFound();
    await assertProductAccess(deps.db(), customer.customerId, product[0].id);
    const { rows } = await deps.db().query(
      `SELECT s.id AS section_id, s.title AS section_title, s.position AS section_position,
              l.id, l.title, l.kind, l.position, COALESCE(lp.resume_seconds, 0) AS resume_seconds, lp.completed_at
         FROM sections s LEFT JOIN lessons l ON l.section_id = s.id
         LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.customer_id = $2
        WHERE s.product_id = $1 ORDER BY s.position, l.position`,
      [product[0].id, customer.customerId],
    );
    const sections = new Map<string, { id: string; title: string; lessons: unknown[] }>();
    for (const r of rows) {
      if (!sections.has(r.section_id)) sections.set(r.section_id, { id: r.section_id, title: r.section_title, lessons: [] });
      if (r.id) sections.get(r.section_id)!.lessons.push({ id: r.id, title: r.title, kind: r.kind, resumeSeconds: r.resume_seconds, completed: Boolean(r.completed_at) });
    }
    return { cache: 'private', body: { product: { slug, title: product[0].title }, sections: [...sections.values()] } };
  }),

  'lesson-get': def('GET', 'lessons/{lessonId}', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const lessonId = validate(Uuid, param(ctx, 'lessonId'));
    await assertLessonAccess(deps.db(), customer.customerId, lessonId);
    const { rows } = await deps.db().query(
      `SELECT l.id, l.title, l.kind, l.body_html, l.transcript,
              (l.video_asset_id IS NOT NULL) AS has_video, (l.caption_asset_id IS NOT NULL) AS has_captions
         FROM lessons l WHERE l.id = $1`,
      [lessonId],
    );
    const row = rows[0];
    const resources = await deps.db().query(
      `SELECT a.id, a.version_label, a.mime_type FROM lesson_resources lr JOIN assets a ON a.id = lr.asset_id
        WHERE lr.lesson_id = $1 AND a.status = 'ready' ORDER BY lr.position`,
      [lessonId],
    );
    return {
      cache: 'private',
      body: {
        id: row.id,
        title: row.title,
        kind: row.kind,
        bodyHtml: row.body_html,
        transcript: row.transcript,
        hasVideo: row.has_video,
        hasCaptions: row.has_captions,
        resources: resources.rows.map((r) => ({ assetId: r.id, versionLabel: r.version_label, mimeType: r.mime_type })),
      },
    };
  }),

  'lesson-playback': def('GET', 'lessons/{lessonId}/playback', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const lessonId = validate(Uuid, param(ctx, 'lessonId'));
    const track = validate(z.enum(['video', 'caption']), ctx.request.query.get('track') ?? 'video');
    return { cache: 'private', body: await issuePlaybackUrl(deps.db(), deps.blob(), customer.customerId, lessonId, track) };
  }),

  'lesson-progress': def('PUT', 'lessons/{lessonId}/progress', async (ctx) => {
    requireSameOrigin(ctx);
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const lessonId = validate(Uuid, param(ctx, 'lessonId'));
    const body = await readJson(ctx.request, ProgressBody);
    await recordResumePosition(deps.db(), customer.customerId, lessonId, body.resumeSeconds);
    if (body.completed !== undefined) {
      // Completion is explicit and independent of the playback position; it is never reset automatically.
      await deps.db().query(
        `UPDATE lesson_progress SET completed_at = CASE WHEN $3 THEN COALESCE(completed_at, now()) ELSE NULL END, updated_at = now()
          WHERE customer_id = $1 AND lesson_id = $2`,
        [customer.customerId, lessonId, body.completed],
      );
    }
    return { cache: 'private', body: { saved: true } };
  }),

  // Files of a purchased download product. Entitlement is checked before any asset is listed.
  'library-files': def('GET', 'library/products/{slug}/files', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const slug = validate(Slug, param(ctx, 'slug'));
    const { rows: product } = await deps.db().query<{ id: string; title: string }>('SELECT id, title FROM products WHERE slug = $1', [slug]);
    if (!product[0]) throw apiErrors.notFound();
    await assertProductAccess(deps.db(), customer.customerId, product[0].id);
    const { rows } = await deps.db().query(
      `SELECT id, version_label, mime_type, actual_bytes FROM assets
        WHERE product_id = $1 AND kind = 'file' AND status = 'ready' ORDER BY created_at, id`,
      [product[0].id],
    );
    return {
      cache: 'private',
      body: {
        product: { slug, title: product[0].title },
        files: rows.map((r) => ({ assetId: r.id, versionLabel: r.version_label, mimeType: r.mime_type, bytes: Number(r.actual_bytes ?? 0) })),
      },
    };
  }),

  'asset-download': def('GET', 'assets/{assetId}/download', async (ctx) => {
    const deps = getDeps();
    const customer = await requireCustomer(deps.db(), ctx.request);
    const assetId = validate(Uuid, param(ctx, 'assetId'));
    return { cache: 'private', body: await issueDownloadUrl(deps.db(), deps.blob(), customer.customerId, assetId) };
  }),
};

for (const [name, d] of Object.entries(learningRoutes)) {
  app.http(name, { authLevel: 'anonymous', methods: d.methods, route: d.route, handler: d.handler });
}
