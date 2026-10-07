export interface IdleWatchOptions {
  timeoutMs: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: any) => void;
  onIdle: () => void;
}

export interface IdleWatch {
  /** Marks activity: the timeout starts over. */
  touch(): void;
  stop(): void;
}

/** Calls `onIdle` once when `touch` wasn't called for `timeoutMs`; checks every min(30 s, timeout / 2). */
export function createIdleWatch(opts: IdleWatchOptions): IdleWatch {
  const now = opts.now ?? Date.now;
  const set = opts.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clear = opts.clearInterval ?? ((id: any) => clearInterval(id));
  let last = now();
  let id: unknown = set(() => {
    if (now() - last < opts.timeoutMs) return;
    stop();
    opts.onIdle();
  }, Math.min(30_000, opts.timeoutMs / 2));
  function stop() {
    if (id !== null) clear(id);
    id = null;
  }
  return {
    touch: () => {
      last = now();
    },
    stop,
  };
}
