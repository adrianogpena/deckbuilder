/** Index of the section being read: the last heading whose top (relative to the container's top) is at or above `offset`; the last heading when scrolled to the bottom, 0 before the first one. */
export function activeHeading(tops: readonly number[], offset: number, atBottom: boolean): number {
  if (tops.length === 0) return -1;
  if (atBottom) return tops.length - 1;
  let active = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= offset) active = i;
    else break;
  }
  return active;
}

/** A heading of the rich document: level, text, document position and the `#anchor` that points at it. */
export interface DocHeading {
  level: number;
  text: string;
  pos: number;
  slug: string;
}

/** GitHub-style anchor: lower case, letters, digits, `_` and `-` of any script kept, spaces become `-`. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_\- ]+/gu, '')
    .replace(/ /g, '-');
}

/** The anchors of headings in order; a repeated one gets `-1`, `-2`, ... like GitHub. */
export function headingSlugs(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  const taken = new Set<string>();
  return texts.map((text) => {
    const base = slugify(text);
    let n = seen.get(base) ?? 0;
    let slug = n ? `${base}-${n}` : base;
    while (taken.has(slug)) slug = `${base}-${++n}`;
    seen.set(base, n + 1);
    taken.add(slug);
    return slug;
  });
}

/** The minimum of a ProseMirror node `scanHeadings` reads. */
export interface HeadingSource {
  descendants(visit: (node: { type: { name: string }; attrs: Record<string, unknown>; textContent: string }, pos: number) => boolean | void): void;
}

/** Headings of a ProseMirror document, in order. */
export function scanHeadings(doc: HeadingSource): DocHeading[] {
  const found: Omit<DocHeading, 'slug'>[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    found.push({ level: Number(node.attrs.level) || 1, text: node.textContent.trim(), pos });
    return false;
  });
  const slugs = headingSlugs(found.map((h) => h.text));
  return found.map((h, i) => ({ ...h, slug: slugs[i]! }));
}

/** Lower case without accents, for matching what the user types against a heading. */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** The headings whose text contains `query` (accents and case ignored); all of them for an empty query. */
export function filterHeadings<T extends { text: string }>(headings: readonly T[], query: string): T[] {
  const q = plain(query.trim());
  return q ? headings.filter((h) => plain(h.text).includes(q)) : [...headings];
}

/** The heading an `#anchor` points at (the fragment may be percent-encoded); undefined when none matches. */
export function findAnchor<T extends { slug: string }>(headings: readonly T[], fragment: string): T | undefined {
  let wanted = fragment.replace(/^#/, '');
  try {
    wanted = decodeURIComponent(wanted);
  } catch {
    // keep the raw fragment
  }
  wanted = wanted.toLowerCase();
  return headings.find((h) => h.slug === wanted);
}
