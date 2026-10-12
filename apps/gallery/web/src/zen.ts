import { useSyncExternalStore } from 'react';

// Zen mode (VS Code's Ctrl+K Z): the Explorer turns it on, App hides the nav for it. Not saved.
let on = false;
const listeners = new Set<() => void>();

export function setZen(next: boolean) {
  if (on === next) return;
  on = next;
  for (const fn of listeners) fn();
}

export function useZen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => on,
  );
}
