import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './returnTo';

describe('safeReturnTo', () => {
  it.each(['/library', '/learn/course-a?lesson=2', '/', '/studio#x'])('keeps local path %s', (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    '/%2F%2Fevil.example',
    '/%5Cevil.example',
    'library',
    'javascript:alert(1)',
    '/with space',
    '',
    '/account/confirm?token=abc',
    `/${'a'.repeat(400)}`,
    null,
    42,
  ])('rejects %s', (value) => {
    expect(safeReturnTo(value)).toBe('/library');
  });

  it('uses a custom fallback', () => {
    expect(safeReturnTo('//x', '/')).toBe('/');
  });
});
