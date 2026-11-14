import { describe, expect, it } from 'vitest';
import { checkoutKey, emailTag, forgetCheckoutKey, safeCheckoutUrl } from './checkoutKey';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('checkoutKey', () => {
  it('reuses the key for the same product and email, ignoring case and spaces', () => {
    const store = memoryStore();
    const a = checkoutKey('course-a', 'Reader@Example.com', store);
    expect(checkoutKey('course-a', ' reader@example.com ', store)).toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });
  it('issues a new key for a different email or after forgetting', () => {
    const store = memoryStore();
    const a = checkoutKey('course-a', 'a@example.com', store);
    const b = checkoutKey('course-a', 'b@example.com', store);
    expect(b).not.toBe(a);
    forgetCheckoutKey('course-a', store);
    expect(checkoutKey('course-a', 'b@example.com', store)).not.toBe(b);
  });
  it('never stores the email address', () => {
    const store = memoryStore();
    checkoutKey('course-a', 'secret@example.com', store);
    expect(JSON.stringify([...store.map])).not.toContain('secret');
    expect(emailTag('secret@example.com')).not.toContain('@');
  });
  it('works without storage', () => {
    expect(checkoutKey('course-a', 'a@example.com', null)).toMatch(/^[A-Za-z0-9-]{8,}$/);
  });
});

describe('safeCheckoutUrl', () => {
  it('allows only https', () => {
    expect(safeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_1')).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(safeCheckoutUrl('http://checkout.stripe.com/')).toBeNull();
    expect(safeCheckoutUrl('javascript:alert(1)')).toBeNull();
    expect(safeCheckoutUrl('/relative')).toBeNull();
    expect(safeCheckoutUrl(undefined)).toBeNull();
  });
});
