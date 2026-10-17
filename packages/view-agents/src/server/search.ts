import { readFileSync } from 'node:fs';
import { realPrompt } from './discovery.ts';

export interface SearchHit {
  sessionId: string;
  snippet: string;
}

const CONTEXT = 60;

/** The searchable text of one transcript entry: a real user prompt, or the text blocks of a main-chain assistant message. */
function entryText(e: Record<string, any>): string | undefined {
  if (e.type === 'user') return realPrompt(e);
  if (e.type !== 'assistant' || e.isSidechain === true) return undefined;
  const c = e.message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return undefined;
  const t = c.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return t || undefined;
}

/** A one-line snippet around the match at `at` in `text`. */
export function snippetAt(text: string, at: number, len: number): string {
  const from = Math.max(0, at - CONTEXT);
  const to = Math.min(text.length, at + len + CONTEXT);
  return (from > 0 ? '...' : '') + text.slice(from, to).replace(/\s+/g, ' ').trim() + (to < text.length ? '...' : '');
}

/** The snippet of the first case-insensitive match of `q` in the transcript's prompts and assistant text, or undefined. */
export function searchFile(file: string, q: string): string | undefined {
  const needle = q.toLowerCase();
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of raw.split('\n')) {
    if (!line.includes('"type"')) continue;
    let e: Record<string, any>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const text = e && typeof e === 'object' ? entryText(e) : undefined;
    if (!text) continue;
    const at = text.toLowerCase().indexOf(needle);
    if (at >= 0) return snippetAt(text, at, needle.length);
  }
  return undefined;
}

/** Scans `files` in turn, emitting the first hit per session; yields between files and stops when `signal` aborts. */
export async function searchSessions(
  files: Array<{ id: string; file: string }>,
  q: string,
  emit: (hit: SearchHit) => Promise<void> | void,
  signal: AbortSignal,
): Promise<void> {
  const query = q.trim();
  if (!query) return;
  for (const f of files) {
    if (signal.aborted) return;
    const snippet = searchFile(f.file, query);
    if (snippet !== undefined) await emit({ sessionId: f.id, snippet });
    await new Promise<void>((r) => setImmediate(r));
  }
}
