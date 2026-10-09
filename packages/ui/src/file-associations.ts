import { isRecord } from '@deckbuilder/server-core/protocol';

/** Opens the files whose name matches `pattern` as if their extension were `as`. */
export interface FileAssociation {
  /** Glob on the file name (`*` any text, `?` one character), case-insensitive. */
  pattern: string;
  /** An extension without the dot, e.g. `log`. */
  as: string;
}

export const MAX_FILE_ASSOCIATIONS = 100;
const AS = /^[a-z0-9]{1,16}$/;

/** app.log, and rotated ones: server.log.1, server.log.2026-10-08. */
export const LOG_NAME = /\.log(\.[0-9][\w-]*)?$/i;

const globToRegExp = (glob: string) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');

let rules: { test: RegExp; as: string }[] = [];

/** Sets the associations the app applies; the first matching one wins. */
export function setFileAssociations(list: readonly FileAssociation[] | undefined): void {
  rules = (list ?? []).map((a) => ({ test: globToRegExp(a.pattern), as: a.as }));
}

/** The name to judge a file by: `name` itself, or `file.<as>` when an association matches it. */
export function effectiveName(name: string): string {
  const rule = rules.find((r) => r.test.test(name));
  return rule ? `file.${rule.as}` : name;
}

/** A copy of `raw` when it is a list of well-formed associations, else null. */
export function validFileAssociations(raw: unknown): FileAssociation[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_FILE_ASSOCIATIONS) return null;
  const out: FileAssociation[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.pattern !== 'string' || typeof item.as !== 'string') return null;
    const pattern = item.pattern.trim();
    const as = item.as.trim().replace(/^\./, '').toLowerCase();
    if (!pattern || pattern.length > 100 || /[\\/]/.test(pattern) || !AS.test(as)) return null;
    out.push({ pattern, as });
  }
  return out;
}
