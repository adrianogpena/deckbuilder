import { DNS_1123 } from './model';

export const MAX_LINES = 5000;
export const DEFAULT_TAIL = 500;
export const GRACE_MS = 10_000;
export const STALE_MS = 120_000;

const CONTEXT_RE = /^[A-Za-z0-9._:@/-]{1,200}$/;

export type LogStatus = 'running' | 'restarting' | 'ended';
export type LogMessage = { lines: string[] } | { status: LogStatus; error?: string };
export type LogListener = (message: LogMessage) => void;

export interface PodLogTarget {
  context: string;
  namespace: string;
  pod: string;
}

export interface LogChild {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}
export type SpawnLogs = (cmd: string[]) => LogChild;

export function validateTarget(t: Partial<Record<keyof PodLogTarget, unknown>>): PodLogTarget | null {
  const { context, namespace, pod } = t;
  if (typeof context !== 'string' || !CONTEXT_RE.test(context)) return null;
  if (typeof namespace !== 'string' || !CONTEXT_RE.test(namespace)) return null;
  if (typeof pod !== 'string' || !DNS_1123.test(pod)) return null;
  return { context, namespace, pod };
}

export function parseTail(raw: string | null): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return DEFAULT_TAIL;
  return Math.min(MAX_LINES, Math.max(0, Math.floor(n)));
}

/** A bounded list of lines; the oldest drop out first. */
export class RingBuffer {
  private items: string[] = [];
  constructor(private readonly max: number) {}
  push(lines: string[]): void {
    this.items.push(...lines);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }
  last(n: number): string[] {
    return n <= 0 ? [] : this.items.slice(-n);
  }
  get size(): number {
    return this.items.length;
  }
}

/** Splits streamed text into complete lines, keeping the unfinished tail for the next chunk. */
export class LineSplitter {
  private rest = '';
  push(chunk: string): string[] {
    const parts = (this.rest + chunk).split(/\r?\n/);
    this.rest = parts.pop() ?? '';
    return parts;
  }
  flush(): string[] {
    const out = this.rest ? [this.rest] : [];
    this.rest = '';
    return out;
  }
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
const LEVELS: [RegExp, LogLevel][] = [
  [/\b(?:ERROR|SEVERE|FATAL|CRITICAL)\b/i, 'error'],
  [/\b(?:WARN|WARNING)\b/i, 'warn'],
  [/\bINFO\b/i, 'info'],
  [/\b(?:DEBUG|TRACE)\b/i, 'debug'],
];
const EXCEPTION = /Exception|Error:|^\s+at\s/;

/** The level word that appears first in the line; stack-trace lines without one are errors. */
export function detectLevel(line: string): LogLevel | null {
  let best: { at: number; level: LogLevel } | null = null;
  for (const [re, level] of LEVELS) {
    const m = re.exec(line);
    if (m && (!best || m.index < best.at)) best = { at: m.index, level };
  }
  if (best) return best.level;
  return EXCEPTION.test(line) ? 'error' : null;
}

export const isException = (line: string): boolean => EXCEPTION.test(line);

interface Entry {
  key: string;
  target: PodLogTarget;
  buffer: RingBuffer;
  listeners: Set<LogListener>;
  child: LogChild | null;
  status: LogStatus;
  generation: number;
  graceTimer: ReturnType<typeof setTimeout> | null;
  staleTimer: ReturnType<typeof setTimeout> | null;
}

export interface PodLogHubOptions {
  spawn?: SpawnLogs;
  graceMs?: number;
  staleMs?: number;
  maxLines?: number;
}

const defaultSpawn: SpawnLogs = (cmd) => {
  const p = Bun.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  return { stdout: p.stdout, stderr: p.stderr, exited: p.exited, kill: () => p.kill() };
};

/** One `kubectl logs -f` child per pod shared by its listeners; lines live in memory only. */
export class PodLogHub {
  private entries = new Map<string, Entry>();
  private readonly spawn: SpawnLogs;
  private readonly graceMs: number;
  private readonly staleMs: number;
  private readonly maxLines: number;

  constructor(options: PodLogHubOptions = {}) {
    this.spawn = options.spawn ?? defaultSpawn;
    this.graceMs = options.graceMs ?? GRACE_MS;
    this.staleMs = options.staleMs ?? STALE_MS;
    this.maxLines = options.maxLines ?? MAX_LINES;
  }

  /** Sends the buffered tail, then live messages; the returned function leaves. */
  subscribe(target: PodLogTarget, tail: number, listener: LogListener): () => void {
    const key = `${target.context}/${target.namespace}/${target.pod}`;
    let e = this.entries.get(key);
    if (!e) {
      e = {
        key, target, buffer: new RingBuffer(this.maxLines), listeners: new Set(), child: null,
        status: 'running', generation: 0, graceTimer: null, staleTimer: null,
      };
      this.entries.set(key, e);
    }
    if (e.graceTimer) {
      clearTimeout(e.graceTimer);
      e.graceTimer = null;
    }
    const buffered = e.buffer.last(tail);
    if (buffered.length) listener({ lines: buffered });
    listener({ status: e.status });
    e.listeners.add(listener);
    if (!e.child) this.start(e, buffered.length ? 0 : tail);

    const entry = e;
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0 && !entry.graceTimer) {
        entry.graceTimer = setTimeout(() => this.drop(entry), this.graceMs);
      }
    };
  }

  /** Number of running `kubectl logs` children. */
  active(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.child) n++;
    return n;
  }

  stopAll(): void {
    for (const e of [...this.entries.values()]) this.drop(e);
  }

  private drop(e: Entry): void {
    this.stopChild(e);
    if (e.graceTimer) clearTimeout(e.graceTimer);
    this.entries.delete(e.key);
  }

  private stopChild(e: Entry): void {
    e.generation++;
    if (e.staleTimer) clearTimeout(e.staleTimer);
    e.staleTimer = null;
    const c = e.child;
    e.child = null;
    try {
      c?.kill();
    } catch {
      // already gone
    }
  }

  private broadcast(e: Entry, message: LogMessage): void {
    for (const l of [...e.listeners]) l(message);
  }

  private setStatus(e: Entry, status: LogStatus, error?: string): void {
    e.status = status;
    this.broadcast(e, error ? { status, error } : { status });
  }

  private armWatchdog(e: Entry, generation: number): void {
    if (e.staleTimer) clearTimeout(e.staleTimer);
    e.staleTimer = setTimeout(() => {
      if (e.generation !== generation) return;
      this.stopChild(e);
      this.setStatus(e, 'restarting');
      this.start(e, 0, '--since=2m');
    }, this.staleMs);
  }

  private start(e: Entry, tail: number, since?: string): void {
    const { context, namespace, pod } = e.target;
    const cmd = [
      'kubectl', '--context', context, 'logs', '-f', pod, '-n', namespace, '--all-containers=true',
      since ?? `--tail=${tail}`,
    ];
    let child: LogChild;
    try {
      child = this.spawn(cmd);
    } catch (err) {
      this.setStatus(e, 'ended', String((err as Error)?.message ?? err));
      return;
    }
    const generation = ++e.generation;
    e.child = child;
    if (e.status !== 'running') this.setStatus(e, 'running');
    this.armWatchdog(e, generation);

    let errText = '';
    const pump = async (stream: ReadableStream<Uint8Array>, onLines: (lines: string[]) => void, flush: boolean) => {
      const splitter = new LineSplitter();
      const decoder = new TextDecoder();
      try {
        const reader = stream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (e.generation !== generation) return;
          const lines = splitter.push(decoder.decode(value, { stream: true }));
          if (lines.length) onLines(lines);
        }
        if (flush && e.generation === generation) {
          const rest = splitter.flush();
          if (rest.length) onLines(rest);
        }
      } catch {
        // stream closed by kill
      }
    };
    const onOut = (lines: string[]) => {
      this.armWatchdog(e, generation);
      e.buffer.push(lines);
      this.broadcast(e, { lines });
    };
    const out = pump(child.stdout, onOut, true);
    const err = pump(child.stderr, (lines) => { errText = (errText + lines.join('\n')).slice(-500); }, true);
    void Promise.all([out, err, child.exited]).then(
      ([, , code]) => this.onExit(e, generation, code, errText),
      () => this.onExit(e, generation, 1, errText),
    );
  }

  private onExit(e: Entry, generation: number, code: number, errText: string): void {
    if (e.generation !== generation) return;
    e.child = null;
    if (e.staleTimer) clearTimeout(e.staleTimer);
    e.staleTimer = null;
    this.setStatus(e, 'ended', code !== 0 ? errText.trim() || `kubectl exited with ${code}` : undefined);
  }
}
