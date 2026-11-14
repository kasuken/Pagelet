// Strict allowlist sanitizer for lesson rich text. Output is rebuilt from scratch: only the tags below survive,
// text is re-escaped, and links must be absolute http(s). Anything else is dropped or unwrapped.
// Unknown tags keep their text content; dangerous raw-text elements lose their content entirely.

const ALLOWED_TAGS = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br']);
const VOID_TAGS = new Set(['br']);
/** Elements whose content is never rendered as text (scripts, styles, embeds, markup containers). */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'template', 'textarea', 'title',
  'xmp', 'noembed', 'noframes', 'select', 'option', 'frameset', 'applet', 'head', 'audio', 'video', 'canvas',
]);
const MAX_HREF = 2000;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes character references so that link schemes and text are checked in their real form. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});?/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body];
    return named ?? whole;
  });
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Removes control characters (except tab and newline) that browsers may ignore inside URLs and text. */
function stripControls(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    const control = (code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f;
    if (!control) out += ch;
  }
  return out;
}

/** Returns a safe absolute http(s) URL, or null. Whitespace and controls are removed before the scheme check. */
export function safeHttpUrl(raw: string): string | null {
  const cleaned = stripControls(decodeEntities(raw)).replace(/\s+/g, '');
  if (cleaned.length === 0 || cleaned.length > MAX_HREF) return null;
  if (!/^https?:\/\//i.test(cleaned)) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function attributesOf(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) {
    const name = m[1]!.toLowerCase();
    if (name in out) continue;
    out[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/** Sanitizes untrusted lesson HTML. Idempotent: sanitize(sanitize(x)) === sanitize(x). */
export function sanitizeLessonHtml(input: string): string {
  const src = input.split('\u0000').join('');
  const out: string[] = [];
  const open: string[] = [];
  let i = 0;

  const closeTo = (name: string) => {
    const at = open.lastIndexOf(name);
    if (at === -1) return;
    while (open.length > at) out.push(`</${open.pop()}>`);
  };

  while (i < src.length) {
    if (src[i] !== '<') {
      const next = src.indexOf('<', i);
      const end = next === -1 ? src.length : next;
      out.push(escapeText(stripControls(decodeEntities(src.slice(i, end)))));
      i = end;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const end = src.indexOf('>', i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    TAG.lastIndex = i;
    const m = TAG.exec(src);
    if (!m) {
      out.push('&lt;');
      i += 1;
      continue;
    }
    i = TAG.lastIndex;
    const closing = m[1] === '/';
    const name = m[2]!.toLowerCase();

    if (!closing && DROP_WITH_CONTENT.has(name) && !VOID_TAGS.has(name)) {
      // Skip everything up to the matching close tag (or the end of input when it never closes).
      const closer = new RegExp(`</${name}\\s*>`, 'ig');
      closer.lastIndex = i;
      const found = closer.exec(src);
      i = found ? closer.lastIndex : src.length;
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue; // unknown tag: drop the tag, keep its text

    if (closing) {
      if (!VOID_TAGS.has(name)) closeTo(name);
      continue;
    }
    if (VOID_TAGS.has(name)) {
      out.push('<br>');
      continue;
    }
    if (name === 'a') {
      const href = safeHttpUrl(attributesOf(m[3] ?? '').href ?? '');
      if (!href) continue; // a link without a safe target is unwrapped to plain text
      out.push(`<a href="${escapeText(href)}" rel="noopener noreferrer nofollow">`);
    } else {
      out.push(`<${name}>`);
    }
    open.push(name);
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
}
