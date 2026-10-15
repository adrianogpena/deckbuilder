import type { ITheme } from '@xterm/xterm';

/** The 16 ANSI colors of a scheme, in Windows Terminal's key names (`purple` is xterm's `magenta`). */
export const SCHEME_COLORS = [
  'black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite',
] as const;
export type SchemeColor = (typeof SCHEME_COLORS)[number];

/** A custom color scheme (`terminal.schemes`); every color is `#RRGGBB`. */
export type ColorScheme = {
  id: string;
  name: string;
  foreground: string;
  background: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
} & Record<SchemeColor, string>;

export const MAX_SCHEMES = 100;
const HEX = /^#[0-9a-fA-F]{6}$/;
const SCHEME_ID = /^[\w.-]{1,64}$/;
const OPTIONAL_COLORS = ['cursor', 'cursorAccent', 'selectionBackground'] as const;
const SCHEME_KEYS = new Set<string>(['id', 'name', 'foreground', 'background', ...OPTIONAL_COLORS, ...SCHEME_COLORS]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHex = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

/** A stored scheme with only known keys, a short id and name and `#RRGGBB` colors; else null. */
export function validScheme(v: unknown): ColorScheme | null {
  if (!isRecord(v) || !Object.keys(v).every((k) => SCHEME_KEYS.has(k))) return null;
  if (typeof v.id !== 'string' || !SCHEME_ID.test(v.id)) return null;
  if (typeof v.name !== 'string' || !v.name || v.name.length > 80) return null;
  if (!isHex(v.foreground) || !isHex(v.background) || !SCHEME_COLORS.every((k) => isHex(v[k]))) return null;
  if (!OPTIONAL_COLORS.every((k) => v[k] === undefined || isHex(v[k]))) return null;
  return v as ColorScheme;
}

/** Up to MAX_SCHEMES valid schemes with distinct ids, else null. */
export function validSchemes(raw: unknown): ColorScheme[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SCHEMES) return null;
  const out = raw.map(validScheme);
  if (out.some((s) => !s)) return null;
  return new Set(out.map((s) => s!.id)).size === out.length ? (out as ColorScheme[]) : null;
}

/** The xterm theme of a custom scheme. */
export function schemeTheme(s: ColorScheme): ITheme {
  const theme: Record<string, string> = {
    background: s.background,
    foreground: s.foreground,
    cursor: s.cursor ?? s.foreground,
    cursorAccent: s.cursorAccent ?? s.background,
  };
  if (s.selectionBackground) theme.selectionBackground = s.selectionBackground;
  for (const k of SCHEME_COLORS) theme[k.replace(/purple/i, (m) => (m[0] === 'P' ? 'Magenta' : 'magenta'))] = s[k];
  return theme as ITheme;
}

/** JSON text without `//` and `/* *\/` comments and trailing commas (strings left alone). */
function looseJson(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** `#RGB` / `#RRGGBB` (any case) as lowercase `#rrggbb`; null otherwise. */
function hexOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return `#${[...s.slice(1)].map((x) => x + x).join('')}`.toLowerCase();
  return null;
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'scheme';

/** One Windows Terminal scheme object as a ColorScheme without an id; null when a required color is missing. */
function fromWindowsTerminal(v: unknown): Omit<ColorScheme, 'id'> | null {
  if (!isRecord(v) || typeof v.name !== 'string' || !v.name.trim()) return null;
  const foreground = hexOf(v.foreground);
  const background = hexOf(v.background);
  if (!foreground || !background) return null;
  const out: Record<string, string> = { name: v.name.trim().slice(0, 80), foreground, background };
  for (const k of SCHEME_COLORS) {
    const c = hexOf(v[k]);
    if (!c) return null;
    out[k] = c;
  }
  const cursor = hexOf(v.cursorColor ?? v.cursor);
  if (cursor) out.cursor = cursor;
  const accent = hexOf(v.cursorAccent);
  if (accent) out.cursorAccent = accent;
  const selection = hexOf(v.selectionBackground);
  if (selection) out.selectionBackground = selection;
  return out as Omit<ColorScheme, 'id'>;
}

/**
 * Schemes from Windows Terminal JSON: a `schemes` array, one scheme object, or a whole settings.json
 * (comments and trailing commas allowed). Each gets an id `custom-<name>` unique against `taken` and
 * the others; invalid entries are skipped, unparsable text gives [].
 */
export function parseWindowsTerminalSchemes(json: string, taken: Iterable<string> = []): ColorScheme[] {
  let data: unknown;
  try {
    data = JSON.parse(looseJson(json));
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.schemes) ? data.schemes : [data];
  const used = new Set(taken);
  const out: ColorScheme[] = [];
  for (const raw of list) {
    const s = fromWindowsTerminal(raw);
    if (!s) continue;
    const base = `custom-${slug(s.name)}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    out.push({ id, ...s } as ColorScheme);
    if (out.length >= MAX_SCHEMES) break;
  }
  return out;
}
