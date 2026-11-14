// Shared API contracts. Every API boundary validates input with these schemas and
// returns the documented shapes. Keep this package free of runtime-only dependencies.
import { z } from 'zod';

export const PRODUCT_TYPES = ['course', 'download'] as const;
export const PRODUCT_STATUSES = ['draft', 'published', 'archived'] as const;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const ErrorCode = z.enum([
  'validation_failed',
  'not_found',
  'unauthorized',
  'forbidden',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'method_not_allowed',
  'origin_rejected',
  'service_unavailable',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    requestId: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/** Money is always integer minor units (for example cents) plus a three-letter ISO currency. */
export const Money = z.object({
  amountMinor: z.number().int().nonnegative().max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type Money = z.infer<typeof Money>;

export const Email = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());

export const Slug = z.string().min(3).max(80).regex(SLUG_PATTERN, 'Use lowercase letters, numbers and hyphens.');

export const LocalPath = z
  .string()
  .max(300)
  .regex(/^\/(?!\/)[^\\\s]*$/, 'Return URLs must be local paths.')
  .default('/library');

export const Uuid = z.uuid();

export const Cursor = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(512).optional(),
});

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const ProductSummary = z.object({
  id: Uuid,
  slug: Slug,
  productType: z.enum(PRODUCT_TYPES),
  title: z.string(),
  description: z.string(),
  outcomes: z.array(z.string()),
  price: Money,
});
export type ProductSummary = z.infer<typeof ProductSummary>;

export const LoginLinkRequest = z.object({
  email: Email,
  returnTo: LocalPath.optional(),
});
export type LoginLinkRequest = z.infer<typeof LoginLinkRequest>;

export const SessionRequest = z.object({
  token: z.string().min(40).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export const CustomerMe = z.object({
  customer: z.object({ maskedEmail: z.string() }),
});

export const LibraryItem = z.object({
  productId: Uuid,
  slug: Slug,
  productType: z.enum(PRODUCT_TYPES),
  title: z.string(),
  status: z.enum(['active', 'suspended', 'revoked']),
  grantedAt: z.iso.datetime(),
});
export type LibraryItem = z.infer<typeof LibraryItem>;

export const SHOP_CURRENCY_PATTERN = /^[A-Z]{3}$/;

// ---- Owner catalog, curriculum, shop settings and media (C01-C05, M01-M04) ----
// Create schemas carry defaults. Update schemas never do, so an omitted field is left unchanged.

const unique = (ids: string[]) => new Set(ids).size === ids.length;
const uniqueMessage = 'Each id may appear only once.';

export const UpdatePolicy = z.enum(['latest', 'pinned']);
export const Revision = z.number().int().min(1).max(1_000_000);
export const MinorAmount = z.number().int().min(0).max(100_000_000);
export const ProductTitle = z.string().trim().min(1, 'Enter a title.').max(160);
export const ProductDescription = z.string().max(20_000);
export const Outcome = z.string().trim().min(1).max(200);
export const AltText = z.string().trim().max(300);

export const ProductCreate = z.strictObject({
  title: ProductTitle,
  slug: Slug,
  productType: z.enum(PRODUCT_TYPES),
  description: ProductDescription.default(''),
  outcomes: z.array(Outcome).max(12).default([]),
  priceMinor: MinorAmount.default(0),
  coverAssetId: Uuid.nullable().optional(),
  coverAlt: AltText.default(''),
  updatePolicy: UpdatePolicy.default('latest'),
});
export type ProductCreate = z.infer<typeof ProductCreate>;

export const ProductUpdate = z.strictObject({
  revision: Revision,
  title: ProductTitle.optional(),
  slug: Slug.optional(),
  productType: z.enum(PRODUCT_TYPES).optional(),
  description: ProductDescription.optional(),
  outcomes: z.array(Outcome).max(12).optional(),
  priceMinor: MinorAmount.optional(),
  coverAssetId: Uuid.nullable().optional(),
  coverAlt: AltText.optional(),
  updatePolicy: UpdatePolicy.optional(),
});
export type ProductUpdate = z.infer<typeof ProductUpdate>;

/** Lifecycle actions and deletion carry the revision the owner saw. */
export const RevisionAction = z.strictObject({ revision: Revision });
export const RevisionQuery = z.strictObject({ revision: z.string().regex(/^[1-9]\d{0,6}$/, 'Send the current revision.') });

export const SectionCreate = z.strictObject({ title: z.string().trim().min(1, 'Enter a section title.').max(160) });
export const SectionUpdate = z.strictObject({ title: z.string().trim().min(1).max(160).optional() });

export const ReorderRequest = z.strictObject({
  ids: z.array(Uuid).min(1).max(200).refine(unique, uniqueMessage),
});

export const LessonKind = z.enum(['video', 'text']);
export const LessonFields = z.strictObject({
  title: z.string().trim().min(1, 'Enter a lesson title.').max(160),
  kind: LessonKind,
  bodyHtml: z.string().max(200_000),
  transcript: z.string().max(100_000),
  isPreview: z.boolean(),
  videoAssetId: Uuid.nullable(),
  captionAssetId: Uuid.nullable(),
  resourceAssetIds: z.array(Uuid).max(20).refine(unique, uniqueMessage),
});
/** Creation: every field has a default here, not in the update schema. */
export const LessonCreate = z.strictObject({
  title: LessonFields.shape.title,
  kind: LessonKind,
  bodyHtml: LessonFields.shape.bodyHtml.default(''),
  transcript: LessonFields.shape.transcript.default(''),
  isPreview: z.boolean().default(false),
  videoAssetId: Uuid.nullable().optional(),
  captionAssetId: Uuid.nullable().optional(),
  resourceAssetIds: LessonFields.shape.resourceAssetIds.default([]),
});
export const LessonUpdate = z.strictObject({
  title: LessonFields.shape.title.optional(),
  kind: LessonKind.optional(),
  bodyHtml: LessonFields.shape.bodyHtml.optional(),
  transcript: LessonFields.shape.transcript.optional(),
  isPreview: z.boolean().optional(),
  videoAssetId: Uuid.nullable().optional(),
  captionAssetId: Uuid.nullable().optional(),
  resourceAssetIds: LessonFields.shape.resourceAssetIds.optional(),
});
export type LessonCreate = z.infer<typeof LessonCreate>;
export type LessonUpdate = z.infer<typeof LessonUpdate>;

export const ContactLink = z.strictObject({
  label: z.string().trim().min(1).max(60),
  url: z.string().trim().max(300).regex(/^(https:\/\/\S+|mailto:[^\s@]+@[^\s@]+)$/i, 'Use an https or mailto link.'),
});

/** Legal pages are stored as paths or https URLs of the creator's published pages (payments reads these keys). */
export const LegalPath = z
  .string()
  .trim()
  .max(300)
  .regex(/^(\/(?!\/)[^\\\s]*|https:\/\/\S+)$/, 'Use a local path starting with / or an https link.');

export const SellerDetails = z.strictObject({
  legalName: z.string().trim().max(160),
  address: z.string().trim().max(500),
  contactEmail: z.union([Email, z.literal('')]),
  vatId: z.string().trim().max(40),
});

export const LegalPages = z.strictObject({
  terms: LegalPath,
  privacy: LegalPath,
  refund: LegalPath,
});

export const ShopUpdate = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code.').optional(),
  shopName: z.string().trim().min(1).max(120).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  accentHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a six-digit hex colour.').optional(),
  creatorName: z.string().trim().max(120).optional(),
  creatorBio: z.string().trim().max(2000).optional(),
  introduction: z.string().trim().max(2000).optional(),
  featuredProductId: Uuid.nullable().optional(),
  contactLinks: z.array(ContactLink).max(10).optional(),
  sellerDetails: SellerDetails.partial().optional(),
  legalPages: LegalPages.partial().optional(),
  /** Accepting the digital-delivery consent sets its version to at least 1. */
  digitalDeliveryConsentAccepted: z.literal(true).optional(),
  taxMode: z.enum(['unset', 'none', 'stripe_tax_configured']).optional(),
  logoAssetId: Uuid.nullable().optional(),
  logoAlt: AltText.optional(),
});
export type ShopUpdate = z.infer<typeof ShopUpdate>;

export const AssetKind = z.enum(['file', 'video', 'caption', 'cover', 'logo']);
export const VersionLabel = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._ -]+$/, 'Use letters, numbers, dots, dashes and spaces.');

export const UploadRequest = z.strictObject({
  kind: AssetKind,
  productId: Uuid.optional(),
  mimeType: z.string().trim().min(3).max(100),
  declaredBytes: z.number().int().positive().max(10 * 1024 ** 3),
  versionLabel: VersionLabel.default('v1'),
  replacesAssetId: Uuid.optional(),
});
export type UploadRequest = z.infer<typeof UploadRequest>;

export const CleanupRequest = z.strictObject({
  confirm: z.literal(true),
  olderThanHours: z.number().int().min(1).max(720).default(24),
});
