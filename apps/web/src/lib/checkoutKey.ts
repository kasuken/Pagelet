import { newRequestId } from './api';

const PREFIX = 'pagelet.checkout-key.';
const RETURN_SLUG = 'pagelet.checkout-slug';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** A short, non-reversible tag so the email address itself is never written to storage. */
export function emailTag(email: string): string {
  let hash = 2166136261;
  for (const char of email.trim().toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Returns the Idempotency-Key for one (product, email) checkout. Retries and double clicks reuse it;
 * a different email gets a new key. Falls back to an in-memory key when storage is blocked.
 */
export function checkoutKey(slug: string, email: string, store: StorageLike | null = storage()): string {
  const name = `${PREFIX}${slug}`;
  const tag = emailTag(email);
  try {
    const saved = store?.getItem(name);
    if (saved) {
      const [savedTag, key] = saved.split(':');
      if (savedTag === tag && key && /^[A-Za-z0-9_-]{8,128}$/.test(key)) return key;
    }
  } catch {
    // ignore storage failures
  }
  const key = newRequestId();
  try {
    store?.setItem(name, `${tag}:${key}`);
  } catch {
    // ignore storage failures
  }
  return key;
}

export function forgetCheckoutKey(slug: string, store: StorageLike | null = storage()): void {
  try {
    store?.removeItem(`${PREFIX}${slug}`);
  } catch {
    // ignore
  }
}

/** Remembers which product a checkout was for, so the return page can link back to it. */
export function rememberCheckoutSlug(slug: string, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(RETURN_SLUG, slug);
  } catch {
    // ignore
  }
}

export function recallCheckoutSlug(store: StorageLike | null = storage()): string | null {
  try {
    return store?.getItem(RETURN_SLUG) ?? null;
  } catch {
    return null;
  }
}

/** Only follow a checkout redirect to an https URL. */
export function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
