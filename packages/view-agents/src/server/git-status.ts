import type { GitStatus } from '../protocol.ts';

export const GIT_POLL_MS = 5000;
export const GIT_TIMEOUT_MS = 5000;
export const GIT_MAX_PARALLEL = 6;

/** Parses `git status --porcelain=v2 --branch`: branch (null when detached), ahead/behind (0/0 without upstream), dirty entry count. */
export function parsePorcelainV2(text: string): GitStatus {
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  for (const line of text.split('\n')) {
    const l = line.replace(/\r$/, '');
    if (l === '') continue;
    if (l.startsWith('# branch.head ')) {
      const head = l.slice('# branch.head '.length);
      branch = head === '(detached)' ? null : head;
    } else if (l.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(l);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (!l.startsWith('# ')) dirty++;
  }
  return { branch, ahead, behind, dirty };
}

/** Runs git status in `cwd`; null on any failure. */
export type GitRunner = (cwd: string) => Promise<string | null>;

export const runGitStatus: GitRunner = async (cwd) => {
  try {
    const proc = Bun.spawn(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch'], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore', windowsHide: true });
    const timer = setTimeout(() => proc.kill(), GIT_TIMEOUT_MS);
    try {
      const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return code === 0 ? out : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
};

export interface GitPollerOptions {
  /** The cwds to poll (de-duplicated here). */
  cwds(): string[];
  onUpdate?(cache: Record<string, GitStatus>): void;
  run?: GitRunner;
  intervalMs?: number;
  enabled?: boolean;
}

export interface GitPoller {
  start(): void;
  stop(): void;
  setEnabled(on: boolean): void;
  /** Polls now unless a poll is running; resolves when it ends. */
  pollNow(): Promise<void>;
  /** The last result; never runs git. */
  get(): Record<string, GitStatus>;
}

export function createGitPoller(opts: GitPollerOptions): GitPoller {
  const run = opts.run ?? runGitStatus;
  let enabled = opts.enabled ?? true;
  let cache: Record<string, GitStatus> = {};
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | undefined;

  const poll = async () => {
    const list = [...new Set(opts.cwds())];
    const next: Record<string, GitStatus> = {};
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const cwd = list[i++]!;
        const out = await run(cwd).catch(() => null);
        if (out !== null) next[cwd] = parsePorcelainV2(out);
      }
    };
    await Promise.all(Array.from({ length: Math.min(GIT_MAX_PARALLEL, list.length) }, worker));
    if (!enabled) return;
    cache = next;
    opts.onUpdate?.(cache);
  };

  const pollNow = (): Promise<void> => {
    if (!enabled) return Promise.resolve();
    running ??= poll().finally(() => {
      running = undefined;
    });
    return running;
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void pollNow(), opts.intervalMs ?? GIT_POLL_MS);
      timer.unref?.();
      void pollNow();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      if (on) {
        if (timer) void pollNow();
      } else {
        cache = {};
        opts.onUpdate?.(cache);
      }
    },
    pollNow,
    get: () => cache,
  };
}
