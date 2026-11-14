// Response shapes of the public, customer and owner endpoints in docs/API.md that are not
// (yet) exported as types from @pagelet/contracts. Keep these in sync with api/src.

export interface MoneyValue {
  amountMinor: number;
  currency: string;
}

export interface ContactLinkValue {
  label: string;
  url: string;
}

export interface PublicShop {
  shopName: string;
  creator: { name: string | null; bio: string | null };
  introduction: string | null;
  accentHex: string | null;
  currency: string | null;
  contactLinks: ContactLinkValue[];
  legal: { terms: string | null; privacy: string | null; refund: string | null };
  featuredSlug?: string | null;
  taxMode?: TaxMode;
}

export type TaxMode = 'unset' | 'none' | 'stripe_tax_configured';

export interface PublicLesson {
  title: string;
  kind: 'video' | 'text';
  preview: boolean;
}

export interface PublicProduct {
  slug: string;
  productType: 'course' | 'download';
  title: string;
  description: string;
  outcomes: string[];
  price: MoneyValue;
  sections: Array<{ title: string; lessons: PublicLesson[] }>;
}

export type CheckoutStatus = 'pending' | 'paid' | 'failed' | 'expired';

export interface Receipt {
  id: string;
  createdAt: string;
  status: string;
  total: MoneyValue;
  refunded: MoneyValue;
  items: Array<{ productId: string; title: string; unitPrice: MoneyValue }>;
}

export interface OwnerOverview {
  salesLast30Days: { count: number; grossMinor: number; currency: string | null };
  products: Partial<Record<'draft' | 'published' | 'archived', number>>;
  openDisputes: number;
  failedWebhooks: number;
  emails: Partial<Record<'pending' | 'failed' | string, number>>;
  checkoutReady: boolean;
  missingLaunchRequirements: string[];
}

// ---- Owner catalog (C01-C03, O01) ----
export type ProductStatus = 'draft' | 'published' | 'archived';
export interface Issue {
  path: string;
  message: string;
}

export interface OwnerProduct {
  id: string;
  slug: string;
  productType: 'course' | 'download';
  status: ProductStatus;
  title: string;
  description: string;
  outcomes: string[];
  price: MoneyValue;
  coverAssetId: string | null;
  coverAlt: string;
  updatePolicy: 'latest' | 'pinned';
  revision: number;
  publishedVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerLesson {
  id: string;
  title: string;
  kind: 'video' | 'text';
  position: number;
  isPreview: boolean;
  bodyHtml: string;
  transcript: string;
  videoAssetId: string | null;
  captionAssetId: string | null;
  resourceAssetIds: string[];
}

export interface OwnerSection {
  id: string;
  title: string;
  position: number;
  lessons: OwnerLesson[];
}

export interface OwnerFile {
  id: string;
  versionLabel: string;
  status: string;
  mimeType: string;
  declaredBytes: number;
  actualBytes: number | null;
  replacesAssetId: string | null;
  createdAt: string;
  finalizedAt: string | null;
}

export interface OwnerProductDetail extends OwnerProduct {
  sections: OwnerSection[];
  files: OwnerFile[];
  publishReadiness: Issue[];
}

export interface OwnerPreview {
  product: { id: string; slug: string; type: 'course' | 'download'; status: ProductStatus; title: string; description: string; outcomes: string[]; priceMinor: number; revision: number; publishedVersion: number | null };
  sections: Array<{ id: string; title: string; lessons: Array<{ id: string; title: string; kind: 'video' | 'text'; preview: boolean }> }>;
  audience: 'owner';
}

export interface PublicationResult {
  publicationId: string;
  versionNo: number;
  status: 'queued' | 'building' | 'succeeded' | 'failed' | string;
}

// ---- Shop settings (C05) ----
export interface OwnerShopSettings {
  shopName: string;
  currency: string | null;
  timezone: string | null;
  accentHex: string | null;
  creatorName: string | null;
  creatorBio: string | null;
  introduction: string | null;
  featuredProductId: string | null;
  contactLinks: ContactLinkValue[] | null;
  sellerDetails: Partial<{ legalName: string; address: string; contactEmail: string; vatId: string }> | null;
  legalPages: Partial<{ terms: string; privacy: string; refund: string }> | null;
  taxMode: TaxMode;
  digitalDeliveryConsentVersion: number;
  legalPolicyVersion: number | null;
  logoAssetId: string | null;
  logoAlt: string | null;
}

export interface OwnerShopResponse {
  settings: OwnerShopSettings | null;
  launchReady: { ready: boolean; missing: string[] };
}

// ---- Orders and support (O02-O04) ----
export interface OwnerOrderRow {
  id: string;
  createdAt: string;
  status: string;
  total: MoneyValue;
  refundedMinor: number;
  customerEmail: string;
  titles: string;
}

export interface OwnerOrderDetail {
  id: string;
  status: string;
  createdAt: string;
  total: MoneyValue;
  refundedMinor: number;
  customerEmail: string;
  policyVersion: number | null;
  items: Array<{ productId: string; title: string; unitPriceMinor: number }>;
  refunds: Array<{ id: string; amountMinor: number; createdAt: string }>;
  grants: Array<{ id: string; source: string; status: string; reason: string | null; updated_at?: string }>;
  providerPaymentId?: string | null;
  events?: Array<{ action: string; details: unknown; created_at?: string; at?: string }>;
}

export interface OwnerCustomerRow {
  id: string;
  email: string;
  orders: number;
  erased: boolean;
  createdAt: string;
}

export interface OwnerCustomerDetail {
  id: string;
  email: string;
  erased: boolean;
  entitlements: Array<{ productId: string; title: string; status: string; grants?: Array<{ id: string; source: string; status: string }> }>;
  orders: Array<{ id: string; status: string; total: MoneyValue; createdAt: string }>;
}

export interface OwnerEmail {
  id: string;
  template: string;
  recipient: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface OwnerWebhookFailure {
  eventId: string;
  type: string;
  receivedAt: string;
  reason: string | null;
}

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  subjectType: string;
  subjectId: string;
  details: unknown;
  at: string;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

// ---- Learning (L02-L04) ----
export interface LearnLessonRef {
  id: string;
  title: string;
  kind: 'video' | 'text';
  resumeSeconds: number;
  completed: boolean;
}

export interface LearnCurriculum {
  product: { slug: string; title: string };
  sections: Array<{ id: string; title: string; lessons: LearnLessonRef[] }>;
}

export interface LearnLesson {
  id: string;
  title: string;
  kind: 'video' | 'text';
  bodyHtml: string;
  transcript: string;
  hasVideo: boolean;
  hasCaptions: boolean;
  resources: Array<{ assetId: string; versionLabel: string; mimeType: string }>;
}

export interface Playback {
  url: string;
  expiresAt: string;
  resumeSeconds: number;
}
