import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@deckbuilderkit/platform';

const MAX_SCOPES = 500;
const MAX_KINDS = 40;
const MAX_KIND_LEN = 40;
const MAX_SCOPE_LEN = 1024;

export interface RightSideEntry {
  list: string[];
  open?: boolean;
  folded?: string[];
}
export type RightSideMap = Record<string, RightSideEntry>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One scope's value with only string kinds kept (deduplicated, capped); undefined when it is not an object. */
export function cleanRightSide(raw: unknown): RightSideEntry | undefined {
  if (!isObject(raw)) return undefined;
  const list = Array.isArray(raw.list) ? [...new Set(raw.list.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_KIND_LEN))].slice(0, MAX_KINDS) : [];
  const folded = Array.isArray(raw.folded) ? [...new Set(raw.folded.filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_KIND_LEN))].slice(0, MAX_KINDS) : [];
  return { list, ...(typeof raw.open === 'boolean' ? { open: raw.open } : {}), ...(folded.length ? { folded } : {}) };
}

export function cleanRightSideMap(raw: unknown): RightSideMap {
  const out: RightSideMap = {};
  if (!isObject(raw)) return out;
  for (const [scope, v] of Object.entries(raw).slice(0, MAX_SCOPES)) {
    const e = cleanRightSide(v);
    if (e && scope.length <= MAX_SCOPE_LEN) out[scope] = e;
  }
  return out;
}

export interface RightSideStore {
  read(): Promise<RightSideMap>;
  /** Merges one scope into the map; false when the value is not a right sidebar state. Writes are best-effort. */
  write(scope: string, value: unknown): Promise<boolean>;
}

/** The right sidebar state of every scope in `<dir>/right-side.json`: `{ version, scopes: { [scope]: { list, open? } } }`. */
export function createRightSideStore(dir: string): RightSideStore {
  const file = join(dir, 'right-side.json');
  const read = async (): Promise<RightSideMap> => {
    const raw = (await readJsonFile(file, isObject).catch(() => undefined)) as { scopes?: unknown } | undefined;
    return cleanRightSideMap(raw?.scopes);
  };
  let chain: Promise<unknown> = Promise.resolve();
  return {
    read,
    async write(scope, value) {
      const entry = cleanRightSide(value);
      if (typeof scope !== 'string' || scope.length > MAX_SCOPE_LEN || !entry) return false;
      const run = chain.then(async () => {
        const map = await read();
        map[scope] = entry;
        await writeJsonAtomic(file, { version: 1, scopes: map }).catch(() => undefined);
      });
      chain = run.catch(() => undefined);
      await run.catch(() => undefined);
      return true;
    },
  };
}
