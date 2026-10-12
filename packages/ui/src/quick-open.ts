import { useEffect, useSyncExternalStore } from 'react';

export interface QuickOpenFile {
  /** Unique across projects. */
  id: string;
  /** Path below the project root, `/`-separated; this is what the query matches. */
  path: string;
  /** Shown beside the path when more than one project is listed. */
  project?: string;
}

export interface QuickOpenSource {
  files: readonly QuickOpenFile[];
  loading: boolean;
  /** Ids of recently opened files, newest first; listed first on an empty query. */
  recent: readonly string[];
  /** Called each time the box opens, so a stale index can reload. */
  onOpen?(): void;
  open(file: QuickOpenFile, side: boolean): void;
}

let current: QuickOpenSource | undefined;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** The source Ctrl+P lists files from; undefined when the shown screen has none. */
export function useQuickOpenSource(): QuickOpenSource | undefined {
  return useSyncExternalStore(subscribe, () => current);
}

/** Offers `source` to the palette while the calling screen is mounted. */
export function useProvideQuickOpen(source: QuickOpenSource | undefined) {
  useEffect(() => {
    current = source;
    for (const fn of listeners) fn();
  }, [source]);
  useEffect(
    () => () => {
      current = undefined;
      for (const fn of listeners) fn();
    },
    [],
  );
}
