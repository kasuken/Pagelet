import { describe, expect, it } from 'vitest';
import { sanitizeLessonHtml, safeHttpUrl } from '../src/services/sanitize.js';

const ALLOWED = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br']);

/** Every tag that survives must be on the allowlist, and no executable markup or scheme may appear. */
function assertSafe(html: string) {
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) expect(ALLOWED.has(m[1]!.toLowerCase()), `tag ${m[1]} in ${html}`).toBe(true);
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/javascript:|vbscript:|data:/i);
  expect(html).not.toMatch(/<\s*(script|style|iframe|object|embed|svg|math|img|link|meta|base|form|input)/i);
  expect(html).not.toMatch(/style\s*=/i);
}

describe('lesson rich-text sanitizer (strict allowlist)', () => {
  const fixtures: Array<[string, string]> = [
    ['plain script', '<p>x</p><script>alert(1)</script>'],
    ['uppercase script', '<SCRIPT SRC="https://evil.test/x.js"></SCRIPT>'],
    ['unclosed script drops rest', '<p>a</p><script>alert(1)'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['svg onload', '<svg onload="alert(1)"><circle/></svg>'],
    ['iframe embed', '<iframe src="https://evil.test"></iframe><p>after</p>'],
    ['object and embed', '<object data="x.swf"></object><embed src="y.swf">'],
    ['style element', '<style>body{background:url(javascript:alert(1))}</style><p>t</p>'],
    ['javascript href', '<a href="javascript:alert(1)">click</a>'],
    ['spaced javascript href', '<a href=" JaVaScRiPt:alert(1)">click</a>'],
    ['entity encoded javascript href', '<a href="&#106;avascript:alert(1)">click</a>'],
    ['hex entity javascript href', '<a href="&#x6A;&#x61;&#x76;&#x61;script:alert(1)">click</a>'],
    ['control char in scheme', '<a href="java\tscript:alert(1)">click</a>'],
    ['data uri link', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ['relative link', '<a href="/internal">x</a>'],
    ['event handler on allowed tag', '<p onclick="steal()">hi</p><em onmouseover="x()">e</em>'],
    ['style attribute on allowed tag', '<p style="position:fixed">hi</p>'],
    ['nested tag tricks', '<<script>script>alert(1)<</script>/script>'],
    ['noscript mXSS', '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>'],
    ['comment wrapper', '<!--<script>alert(1)</script>--><p>ok</p>'],
    ['cdata and processing', '<![CDATA[<script>x</script>]]><?php echo 1 ?><p>ok</p>'],
    ['template and textarea', '<template><script>x</script></template><textarea><script>y</script></textarea>'],
    ['base and meta', '<base href="https://evil.test/"><meta http-equiv="refresh" content="0;url=javascript:alert(1)"><p>t</p>'],
    ['form and input', '<form action="https://evil.test"><input name="pw"><button>go</button></form>'],
    ['unterminated attribute', '<a href="https://ok.test/ title="x>text'],
    ['script split across text', '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'],
    ['null bytes', '<scr\u0000ipt>alert(1)</scr\u0000ipt>'],
    ['link with credentials in scheme', '<a href="https:javascript:alert(1)">x</a>'],
  ];

  for (const [name, input] of fixtures) {
    it(`neutralises: ${name}`, () => {
      const out = sanitizeLessonHtml(input);
      assertSafe(out);
      // Output is idempotent: sanitizing twice changes nothing.
      expect(sanitizeLessonHtml(out)).toBe(out);
    });
  }

  it('keeps the allowed structure and text and adds safe link attributes', () => {
    const out = sanitizeLessonHtml('<h2>Title</h2><p>Some <strong>bold</strong> and <em>soft</em> <a href="https://example.test/a?b=1&amp;c=2">link</a><br></p><ul><li>one</li></ul><h4>x</h4>');
    expect(out).toBe('<h2>Title</h2><p>Some <strong>bold</strong> and <em>soft</em> <a href="https://example.test/a?b=1&amp;c=2" rel="noopener noreferrer nofollow">link</a><br></p><ul><li>one</li></ul><h4>x</h4>');
  });

  it('drops unknown wrappers but keeps their text, and escapes text that looks like markup', () => {
    expect(sanitizeLessonHtml('<div><span>Hi</span> &lt;b&gt;literal&lt;/b&gt;</div>')).toBe('Hi &lt;b&gt;literal&lt;/b&gt;');
  });

  it('turns a link with an unsafe target into plain text', () => {
    expect(sanitizeLessonHtml('<a href="javascript:x">danger</a>')).toBe('danger');
  });

  it('closes elements it opened, even when the input leaves them open', () => {
    expect(sanitizeLessonHtml('<p><strong>open')).toBe('<p><strong>open</strong></p>');
  });

  it('accepts only absolute http(s) URLs after decoding and stripping whitespace', () => {
    expect(safeHttpUrl('https://example.test/x')).toBe('https://example.test/x');
    expect(safeHttpUrl('http://example.test')).toBe('http://example.test/');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('ftp://example.test')).toBeNull();
    expect(safeHttpUrl('//example.test')).toBeNull();
    expect(safeHttpUrl(`https://example.test/${'a'.repeat(2100)}`)).toBeNull();
  });
});
