// Client-side defence in depth for lesson rich text. The API already sanitizes on save with the same allowlist;
// this rebuilds the markup again before it reaches the DOM.
const ALLOWED = new Set(['P', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'A', 'BR']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'TITLE', 'SELECT', 'AUDIO', 'VIDEO', 'CANVAS', 'FORM', 'INPUT', 'BUTTON']);

function safeHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function copyChildren(from: Node, to: Node, doc: Document) {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      to.appendChild(doc.createTextNode(child.textContent ?? ''));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (DROP.has(el.tagName)) continue;
      if (!ALLOWED.has(el.tagName)) {
        copyChildren(el, to, doc);
        continue;
      }
      const clean = doc.createElement(el.tagName.toLowerCase());
      if (el.tagName === 'A') {
        const href = safeHref(el.getAttribute('href'));
        if (!href) {
          copyChildren(el, to, doc);
          continue;
        }
        clean.setAttribute('href', href);
        clean.setAttribute('rel', 'noopener noreferrer nofollow');
        clean.setAttribute('target', '_blank');
      }
      copyChildren(el, clean, doc);
      to.appendChild(clean);
    }
  }
}

/** Returns sanitized HTML containing only the lesson allowlist, with no attributes except safe link hrefs. */
export function sanitizeLessonHtml(html: string): string {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const out = document.implementation.createHTMLDocument('');
  const container = out.createElement('div');
  copyChildren(parsed.body, container, out);
  return container.innerHTML;
}
