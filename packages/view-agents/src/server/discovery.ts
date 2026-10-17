import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentSession, AgentTokens } from '../protocol.ts';

export type { AgentSession };

export interface ProjectRef {
  name: string;
  path: string;
}

type Entry = Record<string, any>;

const CHUNK = 64 * 1024;
const SYNTHETIC = ['<command-name>', '<local-command-', '<command-message>', '<system-reminder>', '<usage>'];

function readRange(file: string, start: number, length: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, start);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function parseLines(text: string, dropFirst: boolean, dropLast: boolean): Entry[] {
  const lines = text.split('\n');
  if (dropFirst) lines.shift();
  if (dropLast) lines.pop();
  const out: Entry[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === 'object') out.push(v);
    } catch {
      /* partial or corrupt line */
    }
  }
  return out;
}

/** The text of a real user prompt, or undefined for synthetic turns and tool results. */
export function realPrompt(entry: Entry): string | undefined {
  if (entry.type !== 'user' || entry.isMeta === true || entry.isSidechain === true) return undefined;
  const content = entry.message?.content;
  let text: string | undefined;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    if (content.some((c) => c?.type === 'tool_result')) return undefined;
    text = content.find((c) => c?.type === 'text' && typeof c.text === 'string')?.text;
  }
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed || SYNTHETIC.some((p) => trimmed.startsWith(p))) return undefined;
  return trimmed;
}

function entryTitle(e: Entry): string | undefined {
  const v =
    e.type === 'summary' ? e.summary : e.type === 'ai-title' ? e.aiTitle : e.type === 'custom-title' ? e.customTitle : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function truncate(s: string, n = 80): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** Decodes a project folder name (`C--x-y` -> `C:\x\y`), a fallback when no transcript line has a cwd. */
export function decodeFolderName(name: string): string {
  const m = /^([A-Za-z])--(.*)$/.exec(name);
  if (m) return `${m[1]}:\\${m[2].replace(/-/g, '\\')}`;
  return name.replace(/-/g, '/');
}

/** Parses the head (and tail) of a transcript; null for files that are not sessions. */
export function parseTranscript(
  file: string,
  size: number,
  meta: { id: string; account: string; folder: string; mtime: number },
): AgentSession | null {
  const head = parseLines(readRange(file, 0, Math.min(size, CHUNK)), false, size > CHUNK);
  const tail = size > CHUNK ? parseLines(readRange(file, size - CHUNK, CHUNK), true, false) : [];
  if (head.length > 0 && head.every((e) => e.isSidechain === true)) return null;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let firstPrompt: string | undefined;
  let title: string | undefined;
  let model: string | undefined;
  for (const e of head) {
    if (e.isSidechain === true) continue;
    if (!cwd && typeof e.cwd === 'string' && e.cwd) cwd = e.cwd;
    if (!gitBranch && typeof e.gitBranch === 'string' && e.gitBranch) gitBranch = e.gitBranch;
    if (!firstPrompt) firstPrompt = realPrompt(e);
  }
  for (const e of [...head, ...tail]) {
    if (e.isSidechain === true) continue;
    const t = entryTitle(e);
    if (t) title = t;
    const m = e.message?.model;
    if (e.type === 'assistant' && typeof m === 'string' && m && m !== '<synthetic>') model = m;
  }
  if (!firstPrompt && !title) return null;
  return {
    id: meta.id,
    account: meta.account,
    cwd: cwd ?? decodeFolderName(meta.folder),
    title: title ? truncate(title, 200) : truncate(firstPrompt ?? meta.id),
    firstPrompt: truncate(firstPrompt ?? ''),
    updatedAt: meta.mtime,
    gitBranch,
    model,
  };
}

/** Running token sums of a transcript, fed only with the bytes appended since `offset`. */
export interface TokenTally {
  /** Bytes consumed (through the last complete line). */
  offset: number;
  tokens: AgentTokens;
  /** Usage counted per assistant message id: Claude writes one entry per content block, repeating the usage. */
  byMessage: Map<string, AgentTokens>;
  /** Input + cache tokens of the last main-chain assistant turn (its context size). */
  lastContext?: number;
}

const TOKEN_KEYS = ['input', 'output', 'cacheCreation', 'cacheRead'] as const;
const TALLY_CHUNK = 1024 * 1024;

export const newTally = (): TokenTally => ({ offset: 0, tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }, byMessage: new Map() });

function usageTokens(u: unknown): AgentTokens | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return { input: n(o.input_tokens), output: n(o.output_tokens), cacheCreation: n(o.cache_creation_input_tokens), cacheRead: n(o.cache_read_input_tokens) };
}

/** Adds one transcript entry's `message.usage`; a repeated message id replaces its earlier count. */
export function tallyEntry(t: TokenTally, e: Entry): void {
  if (e.type !== 'assistant') return;
  const u = usageTokens(e.message?.usage);
  if (!u) return;
  const id = typeof e.message?.id === 'string' && e.message.id ? e.message.id : typeof e.uuid === 'string' ? e.uuid : undefined;
  const prev = id ? t.byMessage.get(id) : undefined;
  for (const k of TOKEN_KEYS) t.tokens[k] += u[k] - (prev?.[k] ?? 0);
  if (id) t.byMessage.set(id, u);
  if (e.isSidechain !== true) t.lastContext = u.input + u.cacheCreation + u.cacheRead;
}

/** Feeds the complete lines appended since `t.offset`; starts over when the file shrank (rewritten). */
export function updateTally(file: string, size: number, prev: TokenTally): TokenTally {
  const t = size < prev.offset ? newTally() : prev;
  if (size === t.offset) return t;
  const fd = openSync(file, 'r');
  try {
    let pos = t.offset;
    let rest = Buffer.alloc(0);
    while (pos < size) {
      const chunk = Buffer.alloc(Math.min(TALLY_CHUNK, size - pos));
      const n = readSync(fd, chunk, 0, chunk.length, pos);
      if (n <= 0) break;
      pos += n;
      const buf = rest.length ? Buffer.concat([rest, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      const nl = buf.lastIndexOf(0x0a);
      if (nl < 0) {
        rest = buf;
        continue;
      }
      for (const e of parseLines(buf.subarray(0, nl).toString('utf8'), false, false)) tallyEntry(t, e);
      t.offset += nl + 1;
      rest = buf.subarray(nl + 1);
    }
  } finally {
    closeSync(fd);
  }
  return t;
}

/** Context used in percent from the last turn's input + cache tokens; the window is 200k for Claude models (1M once above that). */
export function contextPercentOf(model: string | undefined, used: number | undefined): number | undefined {
  if (!used || !model || !/^claude-/i.test(model)) return undefined;
  const window = /\[1m\]/i.test(model) || used > 200_000 ? 1_000_000 : 200_000;
  return Math.min(100, Math.round((used / window) * 100));
}

interface CacheEntry {
  mtime: number;
  size: number;
  session: AgentSession | null;
  tally: TokenTally;
}

/** Scanner caching each transcript by (mtime, size); only changed files are re-parsed, and token sums read only the appended bytes. */
export function createSessionScanner() {
  const cache = new Map<string, CacheEntry>();
  return {
    /** Forgets every cached transcript so the next scan re-reads them. */
    clear(): void {
      cache.clear();
    },
    scan(accounts: Array<{ id: string; dir: string }>): AgentSession[] {
      const seen = new Set<string>();
      const out: AgentSession[] = [];
      for (const acc of accounts) {
        const root = join(acc.dir, 'projects');
        let folders: string[] = [];
        try {
          folders = readdirSync(root, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
        } catch {
          continue;
        }
        for (const folder of folders) {
          let files: string[] = [];
          try {
            files = readdirSync(join(root, folder)).filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'));
          } catch {
            continue;
          }
          for (const f of files) {
            const file = join(root, folder, f);
            seen.add(file);
            let st;
            try {
              st = statSync(file);
            } catch {
              continue;
            }
            let c = cache.get(file);
            if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
              let session: AgentSession | null = null;
              let tally = c?.tally ?? newTally();
              try {
                session = parseTranscript(file, st.size, { id: f.slice(0, -6), account: acc.id, folder, mtime: st.mtimeMs });
                tally = updateTally(file, st.size, tally);
              } catch {
                session = null;
              }
              if (session) {
                const tk = tally.tokens;
                if (tk.input + tk.output + tk.cacheCreation + tk.cacheRead > 0) session.tokens = { ...tk };
                const pct = contextPercentOf(session.model, tally.lastContext);
                if (pct !== undefined) session.contextPercent = pct;
              }
              c = { mtime: st.mtimeMs, size: st.size, session, tally };
              cache.set(file, c);
            }
            if (c.session) out.push(c.session);
          }
        }
      }
      for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
      return out;
    },
  };
}

function norm(p: string, ci: boolean): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return ci ? s.toLowerCase() : s;
}

/** The project whose path equals or contains the cwd (longest match wins). */
export function matchProject<P extends ProjectRef>(
  cwd: string,
  projects: P[],
  caseInsensitive = process.platform === 'win32',
): P | undefined {
  const c = norm(cwd, caseInsensitive);
  let best: P | undefined;
  let bestLen = -1;
  for (const p of projects) {
    const pp = norm(p.path, caseInsensitive);
    if ((c === pp || c.startsWith(`${pp}/`)) && pp.length > bestLen) {
      best = p;
      bestLen = pp.length;
    }
  }
  return best;
}

/** At most `cap` sessions per project: live ones first (always kept), then newest by `updatedAt`. Original order is kept; archived ones use slots. */
export function capPerProject<T extends { project?: string; live?: boolean; updatedAt: number }>(items: T[], cap: number): T[] {
  const keep = new Set<T>();
  const by = new Map<string, T[]>();
  for (const x of items) {
    if (x.project === undefined || x.live) {
      keep.add(x);
      continue;
    }
    const l = by.get(x.project);
    if (l) l.push(x);
    else by.set(x.project, [x]);
  }
  for (const [project, rest] of by) {
    const used = items.filter((x) => x.project === project && x.live).length;
    rest.sort((a, b) => b.updatedAt - a.updatedAt);
    for (const x of rest.slice(0, Math.max(0, cap - used))) keep.add(x);
  }
  return items.filter((x) => keep.has(x));
}
