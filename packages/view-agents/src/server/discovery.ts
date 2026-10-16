import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentSession } from '../protocol.ts';

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

interface CacheEntry {
  mtime: number;
  size: number;
  session: AgentSession | null;
}

/** Scanner caching each transcript by (mtime, size); only changed files are re-parsed. */
export function createSessionScanner() {
  const cache = new Map<string, CacheEntry>();
  return {
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
              try {
                session = parseTranscript(file, st.size, { id: f.slice(0, -6), account: acc.id, folder, mtime: st.mtimeMs });
              } catch {
                session = null;
              }
              c = { mtime: st.mtimeMs, size: st.size, session };
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
