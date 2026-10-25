import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@kedalion/platform';

const MAX_KEYS = 50;
const MAX_KEY_LEN = 100;
const MAX_VALUE_BYTES = 64 * 1024;

export type UiStateMap = Record<string, Record<string, unknown>>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when `value` is a plain JSON object small enough to store. */
export function validUiValue(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  try {
    return JSON.stringify(value).length <= MAX_VALUE_BYTES;
  } catch {
    return false;
  }
}

export function cleanUiState(raw: unknown): UiStateMap {
  const out: UiStateMap = {};
  if (!isObject(raw)) return out;
  for (const [key, v] of Object.entries(raw).slice(0, MAX_KEYS)) {
    if (key.length <= MAX_KEY_LEN && validUiValue(v)) out[key] = v;
  }
  return out;
}

export interface UiStateStore {
  read(): Promise<UiStateMap>;
  /** Merges one key; false when the key or value is not storable. Writes are best-effort. */
  write(key: unknown, value: unknown): Promise<boolean>;
}

/** Persistent UI state of the Agents screen (sections, widths, ...) in `<dir>/ui-state.json`: `{ version, values: { [key]: object } }`. */
export function createUiStateStore(dir: string): UiStateStore {
  const file = join(dir, 'ui-state.json');
  const read = async (): Promise<UiStateMap> => {
    const raw = (await readJsonFile(file, isObject).catch(() => undefined)) as { values?: unknown } | undefined;
    return cleanUiState(raw?.values);
  };
  let chain: Promise<unknown> = Promise.resolve();
  return {
    read,
    async write(key, value) {
      if (typeof key !== 'string' || !key || key.length > MAX_KEY_LEN || !validUiValue(value)) return false;
      const run = chain.then(async () => {
        const map = await read();
        if (!(key in map) && Object.keys(map).length >= MAX_KEYS) return;
        map[key] = value;
        await writeJsonAtomic(file, { version: 1, values: map }).catch(() => undefined);
      });
      chain = run.catch(() => undefined);
      await run.catch(() => undefined);
      return true;
    },
  };
}
