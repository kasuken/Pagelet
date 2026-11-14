import { describe, expect, it } from 'vitest';
import { decimalPrice, productBody, productHead, robots, safeJson, sanitizeExport, siteOrigin, sitemap } from './staticPages';

// Test fixture only: never shipped.
const raw = {
  shop: { shopName: 'Fixture <Shop>', introduction: 'Intro', creator: { name: 'Fixture Creator', bio: 'x' }, objectKey: 'secret' },
  items: [
    {
      slug: 'fixture-course',
      productType: 'course',
      title: 'Fixture </script><script>alert(1)</script>',
      description: 'First paragraph.\n\nSecond & last.',
      outcomes: ['Do a thing'],
      price: { amountMinor: 4900, currency: 'EUR' },
      sections: [{ title: 'Start', lessons: [{ title: 'Lesson one', kind: 'video', preview: true, bodyHtml: '<b>private</b>' }] }],
      storageKey: 'should-not-appear',
    },
    { slug: 'Bad Slug', productType: 'course', title: 'x', price: { amountMinor: 1, currency: 'EUR' } },
    { slug: 'yen-file', productType: 'download', title: 'Yen', description: '', outcomes: [], price: { amountMinor: 1200, currency: 'JPY' }, sections: [] },
    { slug: 'no-price', productType: 'download', title: 'x' },
  ],
};

describe('static export', () => {
  const data = sanitizeExport(raw);

  it('keeps only valid products and public fields', () => {
    expect(data.items.map((p) => p.slug)).toEqual(['fixture-course', 'yen-file']);
    const text = JSON.stringify(data);
    expect(text).not.toContain('should-not-appear');
    expect(text).not.toContain('private');
    expect(text).not.toContain('secret');
  });

  it('escapes HTML and script-breaking JSON', () => {
    const head = productHead(data.items[0]!, data.shop, 'https://shop.example');
    const body = productBody(data.items[0]!, data.shop);
    expect(head).not.toContain('</script><script>');
    expect(head).toContain('\\u003c/script\\u003e');
    expect(body).not.toContain('<script>');
    expect(body).toContain('Second &amp; last.');
    expect(head).toContain('<link rel="canonical" href="https://shop.example/products/fixture-course" />');
    expect(safeJson('</script>')).toBe('"\\u003c/script\\u003e"');
  });

  it('formats offer prices using currency decimals', () => {
    expect(decimalPrice({ amountMinor: 4900, currency: 'EUR' })).toBe('49.00');
    expect(decimalPrice({ amountMinor: 1200, currency: 'JPY' })).toBe('1200');
  });

  it('writes a sitemap and robots rules that exclude private routes', () => {
    expect(sitemap('https://shop.example', data)).toContain('<loc>https://shop.example/products/yen-file</loc>');
    const rules = robots('https://shop.example');
    for (const path of ['/library', '/account/', '/checkout/', '/studio', '/api/']) expect(rules).toContain(`Disallow: ${path}`);
    expect(rules).toContain('Sitemap: https://shop.example/sitemap.xml');
    expect(robots(null)).not.toContain('Sitemap');
  });

  it('only accepts https origins (or localhost)', () => {
    expect(siteOrigin({ PAGELET_SITE_ORIGIN: 'https://shop.example/path' })).toBe('https://shop.example');
    expect(siteOrigin({ PUBLIC_API_BASE: 'http://shop.example' })).toBeNull();
    expect(siteOrigin({})).toBeNull();
  });
});
