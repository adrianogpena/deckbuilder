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

// A title a view publishes for the window title, e.g. "project — session". undefined clears it.
let viewTitle: string | undefined;

export function setViewTitle(text: string | undefined): void {
  const next = text?.trim() || undefined;
  if (next === viewTitle) return;
  viewTitle = next;
  for (const l of listeners) l();
}

export function useViewTitle(): string | undefined {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => viewTitle);
}

export function useTitleBadge(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => count);
}
