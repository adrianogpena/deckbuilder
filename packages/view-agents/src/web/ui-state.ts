/**
 * Persistent UI state of the Agents screen (sections, widths, ...) kept on the server. This module is pure: an in-memory
 * map (so a remount paints the last values) plus a persister that `api.ts` installs. Values are plain JSON objects.
 */
export type UiValue = Record<string, unknown>;

/** Fired on `window` after the saved state was fetched and applied. */
export const UI_STATE_EVENT = 'kedalion-agents-ui-state';

const cache = new Map<string, UiValue>();
/** Keys set locally before the load finished: the loaded value must not overwrite them. */
const dirty = new Set<string>();
let persist: ((key: string, value: UiValue) => void) | undefined;
let loaded = false;

export const setUiStatePersister = (fn: (key: string, value: UiValue) => void): void => {
  persist = fn;
};

export const getUiState = (key: string): UiValue | undefined => cache.get(key);

export function setUiState(key: string, value: UiValue): void {
  cache.set(key, value);
  if (!loaded) dirty.add(key);
  persist?.(key, value);
}

/** Applies the server map (keys changed locally meanwhile are kept) and tells listeners; false when it was applied before. */
export function hydrateUiState(map: unknown): boolean {
  if (loaded) return false;
  loaded = true;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const [key, value] of Object.entries(map)) {
      if (!dirty.has(key) && value && typeof value === 'object' && !Array.isArray(value)) cache.set(key, value as UiValue);
    }
  }
  dirty.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(UI_STATE_EVENT));
  return true;
}

export const uiStateLoaded = (): boolean => loaded;
