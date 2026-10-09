/** Splits delimited text (RFC 4180: quoted fields may hold the delimiter, quotes and line breaks). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The delimiter of a `.tsv` file is a tab; a `.csv` one is `;` when the first line has more of them than commas. */
export function delimiterOf(name: string, text: string): string {
  if (/\.tsv$/i.test(name)) return '\t';
  const first = text.slice(0, text.search(/\r|\n|$/));
  const count = (ch: string) => first.split(ch).length - 1;
  return count(';') > count(',') ? ';' : ',';
}

/** Orders cells as numbers when both are numeric, else as text. */
export function compareCells(a: string, b: string): number {
  const x = Number(a);
  const y = Number(b);
  if (a.trim() !== '' && b.trim() !== '' && !Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

const MASKED_KEY = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/;

export interface EnvLine {
  /** The variable name, or null for a comment or blank line. */
  key: string | null;
  value: string;
  /** The text of a comment or blank line. */
  raw: string;
}

/** Reads `KEY=value` lines of a `.env` file; quotes around a value are dropped. */
export function parseEnv(text: string): EnvLine[] {
  return text.split(/\r?\n/).map((raw) => {
    const m = MASKED_KEY.exec(raw);
    if (!m || raw.trimStart().startsWith('#')) return { key: null, value: '', raw };
    let value = m[2]!.trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0]!)) value = value.slice(1, -1);
    return { key: m[1]!, value, raw };
  });
}

/** One hex-dump row per 16 bytes: offset, hex pairs and printable characters. */
export function hexRows(bytes: Uint8Array): { offset: string; hex: string; ascii: string }[] {
  const rows: { offset: string; hex: string; ascii: string }[] = [];
  for (let at = 0; at < bytes.length; at += 16) {
    const chunk = bytes.subarray(at, at + 16);
    let hex = '';
    let ascii = '';
    for (let i = 0; i < 16; i++) {
      if (i < chunk.length) {
        const b = chunk[i]!;
        hex += b.toString(16).padStart(2, '0') + (i === 7 ? '  ' : ' ');
        ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
      } else hex += i === 7 ? '    ' : '   ';
    }
    rows.push({ offset: at.toString(16).padStart(8, '0'), hex, ascii });
  }
  return rows;
}
