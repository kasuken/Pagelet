// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeLessonHtml } from './sanitizeHtml';

describe('sanitizeLessonHtml', () => {
  it('keeps the allowlist and drops everything else', () => {
    const out = sanitizeLessonHtml('<h2 class="x" onclick="a()">Title</h2><p>Hi <strong>you</strong><script>alert(1)</script></p><img src=x onerror=alert(1)><div>kept text</div>');
    expect(out).toBe('<h2>Title</h2><p>Hi <strong>you</strong></p>kept text');
  });
  it('allows only http(s) links and hardens them', () => {
    expect(sanitizeLessonHtml('<a href="javascript:alert(1)">x</a>')).toBe('x');
    expect(sanitizeLessonHtml('<a href="https://example.com/a">x</a>')).toBe('<a href="https://example.com/a" rel="noopener noreferrer nofollow" target="_blank">x</a>');
  });
  it('drops styles and iframes with their content', () => {
    expect(sanitizeLessonHtml('<style>p{}</style><iframe src="https://x">y</iframe><p>ok</p>')).toBe('<p>ok</p>');
  });
});
