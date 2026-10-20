/** A run of text with one SGR style; `cls` is a space-separated list of CSS classes (`ansi-fg-1`, `ansi-bold`, ...). */
export interface Span {
  text: string;
  cls: string;
}

// eslint-disable-next-line no-control-regex
const SGR = /\u001b\[([0-9;:]*)m/g;
// eslint-disable-next-line no-control-regex
const OTHER_ESC = /\u001b(?:\[[0-9;?:]*[ -/]*[@-ln-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g;

interface Style {
  fg?: number;
  bg?: number;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

const fresh = (): Style => ({ bold: false, dim: false, italic: false, underline: false });

const clsOf = (s: Style): string => {
  const c: string[] = [];
  if (s.fg !== undefined) c.push(`ansi-fg-${s.fg}`);
  if (s.bg !== undefined) c.push(`ansi-bg-${s.bg}`);
  if (s.bold) c.push('ansi-bold');
  if (s.dim) c.push('ansi-dim');
  if (s.italic) c.push('ansi-italic');
  if (s.underline) c.push('ansi-underline');
  return c.join(' ');
};

function apply(style: Style, params: string): void {
  const p = params === '' ? [0] : params.split(/[;:]/).map((x) => Number(x) || 0);
  for (let i = 0; i < p.length; i++) {
    const n = p[i]!;
    if (n === 0) Object.assign(style, fresh(), { fg: undefined, bg: undefined });
    else if (n === 1) style.bold = true;
    else if (n === 2) style.dim = true;
    else if (n === 3) style.italic = true;
    else if (n === 4) style.underline = true;
    else if (n === 22) style.bold = style.dim = false;
    else if (n === 23) style.italic = false;
    else if (n === 24) style.underline = false;
    else if (n >= 30 && n <= 37) style.fg = n - 30;
    else if (n >= 90 && n <= 97) style.fg = n - 90 + 8;
    else if (n === 39) style.fg = undefined;
    else if (n >= 40 && n <= 47) style.bg = n - 40;
    else if (n >= 100 && n <= 107) style.bg = n - 100 + 8;
    else if (n === 49) style.bg = undefined;
    else if (n === 38 || n === 48) {
      // 38;5;N maps the 16 theme colors only; 256-color and truecolor values are skipped, not guessed.
      const key = n === 38 ? 'fg' : 'bg';
      if (p[i + 1] === 5) {
        const idx = p[i + 2];
        style[key] = idx !== undefined && idx < 16 ? idx : undefined;
        i += 2;
      } else if (p[i + 1] === 2) {
        style[key] = undefined;
        i += 4;
      }
    }
  }
}

/** The text split into lines, each a list of styled spans. Only SGR colors are kept; text is never interpreted as HTML. */
export function parseLines(input: string): Span[][] {
  const text = input.replace(OTHER_ESC, '');
  const lines: Span[][] = [[]];
  const style = fresh();
  let last = 0;
  const push = (chunk: string) => {
    const parts = chunk.replace(/\r\n/g, '\n').split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      const clean = part.includes('\r') ? part.slice(part.lastIndexOf('\r') + 1) : part;
      if (clean) lines[lines.length - 1]!.push({ text: clean, cls: clsOf(style) });
    });
  };
  for (const m of text.matchAll(SGR)) {
    push(text.slice(last, m.index));
    apply(style, m[1]!);
    last = m.index! + m[0].length;
  }
  push(text.slice(last));
  return lines;
}

/** The text without any escape sequence. */
export const stripAnsi = (s: string): string => s.replace(OTHER_ESC, '').replace(SGR, '');

export const lineText = (line: Span[]): string => line.map((s) => s.text).join('');

/** A span split on the matches of `query` (case-insensitive): `{ text, hit }` pieces. */
export function splitHits(text: string, query: string): Array<{ text: string; hit: boolean }> {
  if (!query) return [{ text, hit: false }];
  const out: Array<{ text: string; hit: boolean }> = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, at)) {
    if (i > at) out.push({ text: text.slice(at, i), hit: false });
    out.push({ text: text.slice(i, i + q.length), hit: true });
    at = i + q.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}
