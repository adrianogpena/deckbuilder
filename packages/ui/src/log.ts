export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LogLine {
  /** Monotonic buffer index. */
  n: number;
  /** Byte offset of the line start in the file. */
  offset: number;
  text: string;
  level: LogLevel | null;
  /** The level was found on this line (not inherited). */
  own: boolean;
  /** The line is still being written. */
  partial?: true;
}

export const HIGHLIGHT_COLORS = ['accent', 'ok', 'warn', 'err', 'info', 'debug'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export interface HighlightTerm {
  text: string;
  color: HighlightColor;
}

export interface LogQuery {
  text: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface LogBookmark {
  offset: number;
  label: string;
  /** Epoch ms. */
  at: number;
  preview: string;
}

/** Structural copy of server-mods' `TailChunk` (ui does not depend on server-mods). */
export interface TailChunkLike {
  from: number;
  to: number;
  text: string;
  partial?: string;
  reset?: true;
}

export interface TailState {
  lines: LogLine[];
  end: number;
  nextN: number;
  rotated: boolean;
}

export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];

const LEVEL_WORDS: Record<string, LogLevel> = {
  FATAL: 'error',
  SEVERE: 'error',
  ERROR: 'error',
  ERR: 'error',
  WARNING: 'warn',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  FINE: 'debug',
  TRACE: 'trace',
  FINER: 'trace',
  FINEST: 'trace',
};
const TOKEN = /(?<![A-Za-z0-9_])(FATAL|SEVERE|ERROR|ERR|WARNING|WARN|INFO|DEBUG|FINEST|FINER|FINE|TRACE)(?![A-Za-z0-9_])/;
const KEYED = /(?:\blevel=|"level"\s*:\s*")(fatal|severe|error|err|warning|warn|info|debug|fine|finest|finer|trace)\b/i;

/** The level named in the first 200 characters of `text`, or null. */
export function levelOf(text: string): LogLevel | null {
  const head = text.length > 200 ? text.slice(0, 200) : text;
  const token = TOKEN.exec(head);
  const keyed = KEYED.exec(head);
  if (token && (!keyed || token.index <= keyed.index)) return LEVEL_WORDS[token[1]!]!;
  return keyed ? LEVEL_WORDS[keyed[1]!.toUpperCase()]! : null;
}

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;

/** The lines of one tail chunk; see the plan's "Log model API" for the offset and level rules. */
export function linesOf(chunk: TailChunkLike, startN: number, prevLevel: LogLevel | null): LogLine[] {
  const out: LogLine[] = [];
  let offset = chunk.from;
  let level = prevLevel;
  let n = startN;
  const add = (raw: string, partial: boolean) => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const own = levelOf(text);
    if (own) level = own;
    const line: LogLine = { n, offset, text, level: own ?? level, own: own !== null };
    if (partial) line.partial = true;
    out.push(line);
  };
  if (chunk.text) {
    const parts = chunk.text.split('\n');
    if (parts.at(-1) === '') parts.pop();
    for (const part of parts) {
      add(part, false);
      offset += byteLength(part) + 1;
      n++;
    }
  }
  if (chunk.partial) add(chunk.partial, true);
  return out;
}

export const emptyTail = (): TailState => ({ lines: [], end: 0, nextN: 0, rotated: false });

export function tailReducer(state: TailState, chunk: TailChunkLike, maxLines = 200_000): TailState {
  if (chunk.reset) return { lines: [], end: chunk.to, nextN: state.nextN, rotated: true };
  const kept = state.lines.at(-1)?.partial ? state.lines.slice(0, -1) : state.lines;
  const nextN = kept.length ? kept.at(-1)!.n + 1 : state.nextN;
  const added = linesOf(chunk, nextN, kept.at(-1)?.level ?? null);
  const real = added.filter((l) => !l.partial).length;
  let lines = kept.concat(added);
  if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);
  return { lines, end: chunk.to, nextN: nextN + real, rotated: state.rotated };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(query: LogQuery): { re: RegExp | null; error: string | null } {
  if (!query.text) return { re: null, error: null };
  const body = query.regex ? query.text : escapeRegex(query.text);
  const source = query.wholeWord ? `\\b(?:${body})\\b` : body;
  try {
    return { re: new RegExp(source, query.caseSensitive ? 'g' : 'gi'), error: null };
  } catch (err) {
    return { re: null, error: (err as Error).message };
  }
}

/** A global RegExp for the query; null for empty text or an invalid regex. */
export const matcher = (query: LogQuery): RegExp | null => compile(query).re;
export const matcherError = (query: LogQuery): string | null => compile(query).error;

export interface Segment {
  text: string;
  /** Index into the terms list. */
  term?: number;
  hit?: true;
}

function hitRanges(text: string, re: RegExp | null): Array<[number, number]> {
  if (!re) return [];
  const ranges: Array<[number, number]> = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (m[0] === '') g.lastIndex++;
    else ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** `text` cut into runs: query hits first, then highlight terms in the text between hits. */
export function segments(text: string, terms: readonly HighlightTerm[], match: RegExp | null): Segment[] {
  const out: Segment[] = [];
  const push = (s: Segment) => {
    if (s.text) out.push(s);
  };
  const lower = text.toLowerCase();
  const termSegments = (from: number, to: number) => {
    let pos = from;
    while (pos < to) {
      let best: { at: number; len: number; term: number } | null = null;
      terms.forEach((t, term) => {
        const needle = t.text.toLowerCase();
        if (!needle) return;
        const at = lower.indexOf(needle, pos);
        if (at < 0 || at + needle.length > to) return;
        if (!best || at < best.at || (at === best.at && needle.length > best.len)) best = { at, len: needle.length, term };
      });
      if (!best) break;
      const b: { at: number; len: number; term: number } = best;
      push({ text: text.slice(pos, b.at) });
      push({ text: text.slice(b.at, b.at + b.len), term: b.term });
      pos = b.at + b.len;
    }
    push({ text: text.slice(pos, to) });
  };
  let pos = 0;
  for (const [a, b] of hitRanges(text, match)) {
    termSegments(pos, a);
    push({ text: text.slice(a, b), hit: true });
    pos = b;
  }
  termSegments(pos, text.length);
  return out;
}

export function filterLines(lines: LogLine[], levels: ReadonlySet<LogLevel> | null): LogLine[] {
  if (!levels) return lines;
  return lines.filter((l) => l.level !== null && levels.has(l.level));
}

export function levelCounts(lines: readonly LogLine[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0, trace: 0 };
  for (const l of lines) if (l.own && l.level) counts[l.level]++;
  return counts;
}

/** Indexes (into `lines`) of the lines with a query hit. */
export function matchIndexes(lines: readonly LogLine[], match: RegExp | null): number[] {
  if (!match) return [];
  const re = new RegExp(match.source, match.flags.replace('g', ''));
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (re.test(l.text)) out.push(i);
  });
  return out;
}

/** The run of `[\w.$:-]` around `index`, without trailing `.:-`; '' on whitespace or other characters. */
export function wordAt(text: string, index: number): string {
  const isWord = (c: string | undefined) => c !== undefined && /[\w.$:-]/.test(c);
  if (!isWord(text[index])) return '';
  let a = index;
  let b = index + 1;
  while (a > 0 && isWord(text[a - 1])) a--;
  while (b < text.length && isWord(text[b])) b++;
  return text.slice(a, b).replace(/[.:-]+$/, '');
}

/** Index of the first line starting at or after byte `offset`; -1 when there is none. */
export function firstLineAtOrAfter(lines: readonly LogLine[], offset: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.offset < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo < lines.length ? lo : -1;
}

export function nextHighlightColor(terms: readonly HighlightTerm[]): HighlightColor {
  const used = new Set(terms.map((t) => t.color));
  return HIGHLIGHT_COLORS.find((c) => !used.has(c)) ?? HIGHLIGHT_COLORS[terms.length % HIGHLIGHT_COLORS.length]!;
}

export const MAX_HIGHLIGHTS = 50;
export const MAX_BOOKMARKS = 50;

/** `terms` plus `text` in the next free color; unchanged for blank text, a duplicate (case-insensitive) or a full list. */
export function addHighlight(terms: HighlightTerm[], text: string): HighlightTerm[] {
  const term = text.trim();
  const lower = term.toLowerCase();
  if (!term || terms.length >= MAX_HIGHLIGHTS || terms.some((t) => t.text.toLowerCase() === lower)) return terms;
  return [...terms, { text: term, color: nextHighlightColor(terms) }];
}

export function nextColor(color: HighlightColor): HighlightColor {
  return HIGHLIGHT_COLORS[(HIGHLIGHT_COLORS.indexOf(color) + 1) % HIGHLIGHT_COLORS.length]!;
}

/** `list` plus `bookmark`; beyond `MAX_BOOKMARKS` the oldest (by `at`) are dropped. */
export function addBookmark(list: LogBookmark[], bookmark: LogBookmark): LogBookmark[] {
  const all = [...list, bookmark];
  if (all.length <= MAX_BOOKMARKS) return all;
  const kept = new Set([...all].sort((a, b) => b.at - a.at).slice(0, MAX_BOOKMARKS));
  return all.filter((b) => kept.has(b));
}

/** The file shrank below the bookmark. */
export const isStale = (b: LogBookmark, endOffset: number | undefined) => endOffset !== undefined && b.offset > endOffset;

/**
 * `lines` with a marker before the first line at or after each bookmark's offset (at the end when
 * there is none). Bookmarks before `windowStart` (the first loaded byte) or stale ones get no marker.
 */
export function withMarkers(
  lines: LogLine[],
  bookmarks: readonly LogBookmark[],
  windowStart: number,
  endOffset: number | undefined,
): Array<LogLine | LogBookmark> {
  const shown = bookmarks
    .filter((b) => b.offset >= windowStart && !isStale(b, endOffset))
    .map((b) => ({ b, at: firstLineAtOrAfter(lines, b.offset) }))
    .map((m) => ({ ...m, at: m.at < 0 ? lines.length : m.at }))
    .sort((x, y) => x.at - y.at || x.b.offset - y.b.offset || x.b.at - y.b.at);
  if (!shown.length) return lines;
  const out: Array<LogLine | LogBookmark> = [];
  let m = 0;
  for (let i = 0; i <= lines.length; i++) {
    while (m < shown.length && shown[m]!.at === i) out.push(shown[m++]!.b);
    if (i < lines.length) out.push(lines[i]!);
  }
  return out;
}
