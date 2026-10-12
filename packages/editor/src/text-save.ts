export type Eol = '\n' | '\r\n';

/** The line break most lines of `text` end with; `fallback` when it has none. */
export function detectEol(text: string, fallback: Eol = '\n'): Eol {
  const crlf = text.split('\r\n').length - 1;
  const lf = text.split('\n').length - 1 - crlf;
  if (crlf === 0 && lf === 0) return fallback;
  return crlf > lf ? '\r\n' : '\n';
}

/** `text` with every line break as `\n`, as the editor holds it. */
export const normalizeEol = (text: string) => text.replace(/\r\n?/g, '\n');

/** Editor text (`\n` breaks) with `eol` breaks, for writing. */
export const applyEol = (text: string, eol: Eol) => (eol === '\n' ? text : text.replace(/\n/g, eol));

/** `text` without spaces and tabs at line ends. */
export const trimTrailingWhitespace = (text: string) => text.replace(/[ \t]+$/gm, '');

/** `text` ending with one line break; an empty text stays empty. */
export const ensureFinalNewline = (text: string) => (text === '' || text.endsWith('\n') ? text : `${text}\n`);

/** The save-time edits of VS Code's `files.trimTrailingWhitespace` and `files.insertFinalNewline`. */
export function prepareForSave(text: string, opts: { trim: boolean; finalNewline: boolean; markdown: boolean }): string {
  let out = opts.trim && !opts.markdown ? trimTrailingWhitespace(text) : text;
  if (opts.finalNewline) out = ensureFinalNewline(out);
  return out;
}
