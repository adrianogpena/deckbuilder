import DOMPurify from 'dompurify';
import { marked } from 'marked';

export interface MarkdownOptions {
  /** Maps a relative image src to a URL the page may load (e.g. a blob URL); null blocks it. */
  resolveImage?(src: string): string | null;
  /** Text of the placeholder that replaces a blocked image. */
  blockedLabel?: string;
}

/** Links that stay: http(s)/mailto open outside the app, `#anchors` jump within the page; anything else loses its href. */
export function linkPolicy(href: string): { href: string; external: boolean } | null {
  const h = href.trim();
  if (h.startsWith('#')) return { href: h, external: false };
  if (/^(https?:|mailto:)/i.test(h)) return { href: h, external: true };
  return null;
}

const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,/i;
// Any scheme (http:, file:, data:, javascript:, ...) or a protocol-relative //host.
const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/** The src an image may use: relative ones go through `resolveImage`, remote and other schemes are blocked. */
export function imagePolicy(src: string, resolveImage?: (src: string) => string | null): string | 'blocked' {
  const s = src.trim();
  if (SAFE_DATA_IMAGE.test(s)) return s;
  if (!s || ABSOLUTE.test(s)) return 'blocked';
  return resolveImage?.(s) ?? 'blocked';
}

const BLOCKED_ATTR = 'data-md-blocked';

/** Markdown (GFM) to sanitized HTML. Needs a DOM (DOMPurify): browser only. */
export function renderMarkdown(md: string, opts: MarkdownOptions = {}): string {
  const raw = marked.parse(md, { gfm: true, async: false }) as string;
  const hook = (node: Element) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      const link = linkPolicy(node.getAttribute('href')!);
      if (!link) {
        node.removeAttribute('href');
      } else if (link.external) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    } else if (node.tagName === 'IMG') {
      node.removeAttribute('srcset');
      const src = imagePolicy(node.getAttribute('src') ?? '', opts.resolveImage);
      if (src === 'blocked') node.setAttribute(BLOCKED_ATTR, node.getAttribute('src') ?? '');
      else node.setAttribute('src', src);
    }
  };
  DOMPurify.addHook('afterSanitizeAttributes', hook);
  let fragment: DocumentFragment;
  try {
    fragment = DOMPurify.sanitize(raw, {
      FORBID_TAGS: ['style', 'iframe', 'form', 'object', 'embed'],
      FORBID_ATTR: ['style'],
      RETURN_DOM_FRAGMENT: true,
    });
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', hook);
  }
  for (const img of fragment.querySelectorAll(`img[${BLOCKED_ATTR}]`)) {
    const span = document.createElement('span');
    span.className = 'md-img-blocked';
    span.title = img.getAttribute(BLOCKED_ATTR) ?? '';
    span.textContent = opts.blockedLabel ?? 'Remote image blocked';
    img.replaceWith(span);
  }
  const box = document.createElement('div');
  box.append(fragment);
  return box.innerHTML;
}
