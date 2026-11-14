// Local copies of contract patterns, so the public bundle never imports zod at runtime.
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]{5,200}$/;
export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 3 && value.length <= 80 && SLUG.test(value);
}
