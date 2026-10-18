import { frontmatter } from '../markdown';

/** A markdown text cut into its leading frontmatter block (verbatim, with its fences and line break) and the rest. */
export interface SplitMarkdown {
  /** The `---` block exactly as in the text, '' when there is none. */
  front: string;
  body: string;
}

/** Splits off the leading frontmatter block; `joinFrontmatter` puts the same bytes back. */
export function splitFrontmatter(md: string): SplitMarkdown {
  const fm = frontmatter(md);
  return fm ? { front: md.slice(0, fm.length), body: md.slice(fm.length) } : { front: '', body: md };
}

/** The text again: the frontmatter unchanged, then the body. */
export function joinFrontmatter({ front, body }: SplitMarkdown): string {
  return front + body;
}

/** The YAML inside a frontmatter block from `splitFrontmatter`; null for ''. */
export function frontmatterYaml(front: string): string | null {
  return front ? (frontmatter(front)?.yaml ?? null) : null;
}

/** Marks a transaction the pane made itself (value sync); only unmarked document changes are user edits. */
export const EXTERNAL_META = 'deckbuilder.richExternal';

interface TransactionLike {
  docChanged: boolean;
  getMeta(key: string): unknown;
}

/**
 * One of the transactions changed the document and is a user edit: not the pane's own value sync and
 * not kept out of history (Milkdown's heading ids and list numbering fix-ups, also dispatched at mount).
 */
export function isUserEdit(trs: readonly TransactionLike[]): boolean {
  return trs.some((tr) => tr.docChanged && !tr.getMeta(EXTERNAL_META) && tr.getMeta('addToHistory') !== false);
}

/**
 * The text the host gets after a user edit: the original text byte for byte while the document equals
 * the one parsed from it (e.g. after undo), else the frontmatter unchanged plus the serialized body.
 */
export function richValue(original: string, front: string, unchanged: boolean, serialize: () => string): string {
  return unchanged ? original : front + serialize();
}
