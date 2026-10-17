import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { normalizeLine } from './chat/normalize.ts';

export interface TailTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const TAIL_BACKFILL_BYTES = 64 * 1024;
export const TAIL_MAX_TURNS = 50;
const POLL_MS = 1000;
const ECHO_PREFIXES = ['<command-name>', '<command-message>', '<command-args>', '<local-command-'];

/** Displayable turns of one jsonl line: user text (not slash-command echoes) and assistant text (no thinking or tool calls). */
export function turnsOfLine(line: string): TailTurn[] {
  if (!line.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  const out: TailTurn[] = [];
  for (const e of normalizeLine(raw)) {
    if (e.type === 'user') {
      const text = e.text.trimStart();
      if (!ECHO_PREFIXES.some((p) => text.startsWith(p))) out.push({ role: 'user', text: e.text });
    } else if (e.type === 'text') out.push({ role: 'assistant', text: e.text });
  }
  return out;
}

export interface Tailer {
  turns(): TailTurn[];
  stop(): void;
}

/** Backfills the last 64 KB of a jsonl, then follows appended bytes. `onTurns` gets the ring (last 50 turns) whenever a turn was added. */
export function createTailer(path: string, onTurns: (turns: TailTurn[]) => void, pollMs = POLL_MS): Tailer {
  let ring: TailTurn[] = [];
  let offset = 0;
  let carry: Buffer = Buffer.alloc(0);
  let started = false;
  let stopped = false;

  const poll = () => {
    if (stopped) return;
    let fd: number;
    try {
      fd = openSync(path, 'r');
    } catch {
      return;
    }
    try {
      const size = fstatSync(fd).size;
      let from = offset;
      let dropFirst = false;
      if (!started) {
        from = Math.max(0, size - TAIL_BACKFILL_BYTES);
        dropFirst = from > 0;
        ring = [];
        carry = Buffer.alloc(0);
      } else if (size < offset) {
        from = 0;
        ring = [];
        carry = Buffer.alloc(0);
      } else if (size === offset) return;
      const buf = Buffer.alloc(size - from);
      let got = 0;
      while (got < buf.length) {
        const n = readSync(fd, buf, got, buf.length - got, from + got);
        if (n <= 0) break;
        got += n;
      }
      offset = from + got;
      let data = Buffer.concat([carry, buf.subarray(0, got)]);
      if (dropFirst) {
        const nl = data.indexOf(10);
        data = nl < 0 ? Buffer.alloc(0) : data.subarray(nl + 1);
      }
      const last = data.lastIndexOf(10);
      carry = last < 0 ? data : data.subarray(last + 1);
      const complete = last < 0 ? '' : data.subarray(0, last).toString('utf8');
      const added: TailTurn[] = [];
      for (const line of complete.split('\n')) added.push(...turnsOfLine(line));
      const first = !started;
      started = true;
      if (added.length) {
        ring = [...ring, ...added].slice(-TAIL_MAX_TURNS);
        onTurns(ring);
      } else if (first) onTurns(ring);
    } finally {
      closeSync(fd);
    }
  };

  poll();
  const timer = setInterval(poll, pollMs);
  return {
    turns: () => ring,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
