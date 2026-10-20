/** Paths a server dialog returned that a later route may accept once. */
export interface PickedPaths {
  add(path: string): void;
  /** True once for a path added less than `ttlMs` ago (exact match); removes it. */
  take(path: string): boolean;
}

/** A one-shot set of dialog results; adding beyond `max` drops the oldest entry. */
export function pickedPaths(opts: { max?: number; ttlMs?: number; now?: () => number } = {}): PickedPaths {
  const { max = 20, ttlMs = 600_000, now = Date.now } = opts;
  const added = new Map<string, number>();
  return {
    add(path) {
      added.delete(path);
      added.set(path, now());
      while (added.size > max) added.delete(added.keys().next().value as string);
    },
    take(path) {
      const at = added.get(path);
      if (at === undefined) return false;
      added.delete(path);
      return now() - at < ttlMs;
    },
  };
}
