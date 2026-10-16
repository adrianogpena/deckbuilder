/** Syntaxes an untitled tab can pick: id → file extension (the editor, SQL and curl panels follow the extension). */
export const UNTITLED_SYNTAXES = {
  text: 'txt',
  markdown: 'md',
  sql: 'sql',
  curl: 'curl',
  json: 'json',
  yaml: 'yaml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  javascript: 'js',
  typescript: 'ts',
  shell: 'sh',
  properties: 'properties',
  python: 'py',
} as const;

export type UntitledSyntax = keyof typeof UNTITLED_SYNTAXES;

export const isUntitledSyntax = (x: unknown): x is UntitledSyntax => typeof x === 'string' && Object.hasOwn(UNTITLED_SYNTAXES, x);

/** The file name an untitled tab of `syntax` acts as, and suggests in the save dialog. */
export const untitledName = (syntax: string) => `untitled.${isUntitledSyntax(syntax) ? UNTITLED_SYNTAXES[syntax] : 'txt'}`;

/** `abs` relative to `root` with `/` separators when inside it (case-insensitive on Windows), else undefined. */
export function relativeInside(root: string, abs: string): string | undefined {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const a = norm(abs);
  const win = /^[a-z]:/i.test(r) || r.startsWith('//');
  const same = (x: string, y: string) => (win ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (a.length <= r.length + 1 || !same(a.slice(0, r.length), r) || a[r.length] !== '/') return undefined;
  return a.slice(r.length + 1);
}
