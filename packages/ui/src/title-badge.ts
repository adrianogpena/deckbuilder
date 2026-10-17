import { useSyncExternalStore } from 'react';

// A count a view publishes for the window title, e.g. "(2) Agents". 0 clears it.

let count = 0;
const listeners = new Set<() => void>();

export function setTitleBadge(n: number): void {
  const next = Math.max(0, Math.floor(n));
  if (next === count) return;
  count = next;
  for (const l of listeners) l();
}

export const titleWithBadge = (title: string, n: number): string => (n > 0 ? `(${n}) ${title}` : title);

export function useTitleBadge(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => count);
}
