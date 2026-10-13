import DOMPurify from 'dompurify';
import { marked } from 'marked';

export interface MarkdownOptions {
  /** Maps a relative image src to a URL the page may load (e.g. a blob URL); null blocks it. */
  resolveImage?(src: string): string | null;
  /** Text of the placeholder that replaces a blocked image. */
  blockedLabel?: string;
}

/** Links that stay: http(s) open outside the app, `#anchors` jump within the page; anything else loses its href. */
export function linkPolicy(href: string): { href: string; external: boolean } | null {
  const h = href.trim();
  if (h.startsWith('#')) return { href: h, external: false };
  if (/^https?:/i.test(h)) return { href: h, external: true };
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

const FRONTMATTER = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** A leading YAML frontmatter block (`---` ... `---`): its full length and its YAML text; null if there is none. */
export function frontmatter(md: string): { length: number; yaml: string } | null {
  const m = FRONTMATTER.exec(md);
  return m ? { length: m[0].length, yaml: m[1] ?? '' } : null;
}

/** Top-level `key: value` pairs of frontmatter YAML; nested lines and list items fold into their key's value. Null if no key is found. */
export function frontmatterEntries(yaml: string): [string, string][] | null {
  const entries: [string, string[]][] = [];
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^([^\s#:-][^:]*?|-[^\s:][^:]*?):(?:\s+(.*))?$/.exec(line.trimEnd());
    if (m) {
      entries.push([m[1], m[2] && !/^[|>][+-]?$/.test(m[2]) ? [unquote(m[2].trim())] : []]);
    } else if (entries.length && line.trim() && !line.trim().startsWith('#')) {
      entries[entries.length - 1][1].push(unquote(line.trim().replace(/^-\s+/, '')));
    }
  }
  if (!entries.length) return null;
  return entries.map(([k, v]) => [k, v.join(', ')]);
}

function unquote(v: string): string {
  return /^(".*"|'.*')$/.test(v) ? v.slice(1, -1) : v;
}

/** The frontmatter as a two-column table (built with textContent, so values are never parsed as HTML). */
export function frontmatterTable(entries: [string, string][]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'md-frontmatter';
  const body = table.createTBody();
  for (const [key, value] of entries) {
    const row = body.insertRow();
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = key;
    row.append(th);
    row.insertCell().textContent = value;
  }
  return table;
}

const BLOCKED_ATTR = 'data-md-blocked';

/** Markdown (GFM) to sanitized HTML. Needs a DOM (DOMPurify): browser only. */
export function renderMarkdown(md: string, opts: MarkdownOptions = {}): string {
  const fm = frontmatter(md);
  const entries = fm ? frontmatterEntries(fm.yaml) : null;
  if (fm) md = (entries ? '' : '~~~~yaml\n' + fm.yaml + '\n~~~~\n') + md.slice(fm.length);
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
      // HTML only: SVG/MathML links and images escape the A/IMG policies above.
      USE_PROFILES: { html: true },
      // Media and <picture> sources would load remote URLs past imagePolicy.
      FORBID_TAGS: ['style', 'iframe', 'form', 'object', 'embed', 'video', 'audio', 'source', 'track', 'picture', 'input', 'button'],
      FORBID_ATTR: ['style', 'ping', 'download', 'formaction', 'background', 'id', 'name'],
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
  if (entries) box.append(frontmatterTable(entries));
  box.append(fragment);
  return box.innerHTML;
}
