import type { EditorState } from '@milkdown/prose/state';
import { linkPolicy } from '../markdown';

// Any scheme (https:, mailto:, file:, C:, ...) or a protocol-relative //host.
const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/\/)/i;
const DRIVE = /^[a-z]:/i;

/** What a link points at: a heading of this file, a web address, or another file of the project. */
export type LinkTarget =
  | { kind: 'anchor'; fragment: string }
  | { kind: 'external'; href: string }
  | { kind: 'file'; path: string };

/** Normalizes a project path: `/` separators, no `.` parts, `..` folded; null when it climbs above the root. */
function normalize(parts: string[]): string | null {
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The project path a relative `href` points at, resolved against the open file; null when there is none. A leading `/` starts at the project root. */
export function resolveLinkPath(fromFile: string, href: string): string | null {
  const raw = href.trim().replace(/[#?].*$/s, '');
  if (!raw || ABSOLUTE.test(raw)) return null;
  const target = decode(raw).replace(/\\/g, '/');
  if (target.startsWith('/')) return normalize(target.split('/')) || null;
  const dir = fromFile.replace(/\\/g, '/').split('/').slice(0, -1);
  return normalize([...dir, ...target.split('/')]) || null;
}

/** Classifies a link: `#x` scrolls, http(s) opens outside (see `linkPolicy`), a relative path opens in the Explorer; anything else is not followed. */
export function classifyLink(href: string, fromFile: string): LinkTarget | null {
  const policy = linkPolicy(href);
  if (policy) return policy.external ? { kind: 'external', href: policy.href } : { kind: 'anchor', fragment: policy.href };
  const path = resolveLinkPath(fromFile, href);
  if (path === null) return null;
  const hash = href.indexOf('#');
  if (path === fromFile && hash >= 0) return { kind: 'anchor', fragment: href.slice(hash) };
  return { kind: 'file', path };
}

/** Escapes what would break a Markdown link destination, keeping other characters readable. */
function encodeSegment(segment: string): string {
  return segment.replace(/[ #?%()<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/** The link target from `fromFile` to `toFile` (both `/`-separated, or drive paths): relative, spaces percent-encoded; `toFile` itself when they share no root. */
export function relativeLinkPath(fromFile: string, toFile: string): string {
  const from = fromFile.replace(/\\/g, '/').split('/').filter(Boolean);
  const to = toFile.replace(/\\/g, '/').split('/').filter(Boolean);
  const fromDrive = DRIVE.test(from[0] ?? '');
  const toDrive = DRIVE.test(to[0] ?? '');
  if (fromDrive !== toDrive || (fromDrive && from[0]!.toLowerCase() !== to[0]!.toLowerCase())) return to.map(encodeSegment).join('/');
  const dir = from.slice(0, -1);
  let common = 0;
  const same = (i: number) => (i === 0 && fromDrive ? dir[i]!.toLowerCase() === to[i]!.toLowerCase() : dir[i] === to[i]);
  while (common < dir.length && common < to.length - 1 && same(common)) common++;
  const up = dir.length - common;
  return [...Array<string>(up).fill('..'), ...to.slice(common)].map(encodeSegment).join('/');
}

/** The href of the link around a collapsed cursor that sits inside it (not at its edge); null otherwise. */
export function linkHrefAtCursor(state: EditorState): string | null {
  const { selection } = state;
  const type = state.schema.marks.link;
  if (!type || !selection.empty) return null;
  const before = selection.$from.nodeBefore;
  const after = selection.$from.nodeAfter;
  const markBefore = before && type.isInSet(before.marks);
  const markAfter = after && type.isInSet(after.marks);
  if (!markBefore || !markAfter || markBefore.attrs.href !== markAfter.attrs.href) return null;
  return String(markBefore.attrs.href ?? '');
}
