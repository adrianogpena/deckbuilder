import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@deckbuilder/platform';
import { invalid, notFound, type Routes } from '@deckbuilder/server-core';
import { fromPlatform } from './platform-errors.ts';

/** A stored record: the app's fields plus the ones the store owns. */
export type Rec<T> = T & { id: string; createdAt: string; updatedAt: string };

/** Where secret field values live instead of the JSON file: `secretStore` from platform, a fake in tests. */
export interface SecretBackend {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  remove(ref: string): Promise<void>;
}

export interface RecordStoreOptions<T extends object> {
  /** Folder of `<name>.json`, usually `appHome(APP.id)`. */
  dir: string;
  name: string;
  /** Builds a fresh `T` from raw client input (never spread the input) and throws `invalid(...)`; `prev` is set on update. */
  validate(input: unknown, prev?: Rec<T>): T;
  /** Most records the store holds. */
  max?: number;
  /**
   * Fields kept in `secrets` instead of the file. Input: a non-empty string sets the secret, `''`
   * removes it, anything else (absent, `{ hasSecret: true }`) keeps it. Every returned record
   * shows `{ hasSecret: true }` instead; app code reads the value with `secret(id, field)`.
   */
  secretFields?: string[];
  secrets?: SecretBackend;
}

export interface RecordStore<T extends object> {
  list(): Promise<Rec<T>[]>;
  get(id: string): Promise<Rec<T>>;
  create(input: unknown): Promise<Rec<T>>;
  update(id: string, input: unknown): Promise<Rec<T>>;
  remove(id: string): Promise<void>;
  /** Server-only: the stored value of a secret field, null when none is set. Never return it from a route. */
  secret(id: string, field: string): Promise<string | null>;
}

interface RecordFile<T> {
  version: 1;
  items: Rec<T>[];
}

/** What a secret field holds in the file. */
interface SecretRef {
  ref: string;
}

const isRef = (v: unknown): v is SecretRef => typeof v === 'object' && v !== null && typeof (v as SecretRef).ref === 'string';

const isRecordFile = (v: unknown) =>
  typeof v === 'object' && v !== null && (v as RecordFile<object>).version === 1 && Array.isArray((v as RecordFile<object>).items);

/** A JSON-file store of records with ids and timestamps; calls are serialized so concurrent ones never lose a record. */
export function recordStore<T extends object>(opts: RecordStoreOptions<T>): RecordStore<T> {
  const secretFields = opts.secretFields ?? [];
  const backend = opts.secrets;
  if (secretFields.length && !backend) throw new Error('recordStore: secretFields need the secrets option');
  const secrets = backend && {
    set: (ref: string, value: string) => backend.set(ref, value).catch(fromPlatform),
    get: (ref: string) => backend.get(ref).catch(fromPlatform),
    remove: (ref: string) => backend.remove(ref).catch(fromPlatform),
  };
  const file = join(opts.dir, `${opts.name}.json`);
  const max = opts.max ?? 500;
  let items: Rec<T>[] | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  const locked = <R>(job: () => Promise<R>): Promise<R> => {
    const run = chain.then(job);
    chain = run.catch(() => {});
    return run;
  };

  async function load(): Promise<Rec<T>[]> {
    if (!items) items = ((await readJsonFile(file, isRecordFile)) as RecordFile<T> | undefined)?.items ?? [];
    return items;
  }

  async function commit(next: Rec<T>[]): Promise<void> {
    await writeJsonAtomic(file, { version: 1, items: next } satisfies RecordFile<T>);
    items = next;
  }

  const find = (all: Rec<T>[], id: string) => {
    const rec = all.find((r) => r.id === id);
    if (!rec) throw notFound('recordNotFound', 'Record not found.');
    return rec;
  };

  const fields = (rec: Rec<T>) => rec as unknown as Record<string, unknown>;

  /** A copy of `rec` as routes may show it: each set secret field is `{ hasSecret: true }`. */
  const masked = (rec: Rec<T>): Rec<T> => {
    const copy = fields(structuredClone(rec));
    for (const field of secretFields) {
      if (isRef(copy[field])) copy[field] = { hasSecret: true };
      else delete copy[field];
    }
    return copy as unknown as Rec<T>;
  };

  /**
   * Sets the secret fields of `rec` from raw `input` (see `secretFields`), storing new values at
   * once; returns the refs to remove once the record is saved.
   */
  async function applySecrets(input: unknown, rec: Rec<T>, prev?: Rec<T>): Promise<string[]> {
    const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    const removals: string[] = [];
    for (const field of secretFields) {
      const value = raw[field];
      const old = prev && fields(prev)[field];
      delete fields(rec)[field];
      if (typeof value === 'string' && value !== '') {
        const ref = `${opts.name}:${rec.id}:${field}`;
        await secrets!.set(ref, value);
        fields(rec)[field] = { ref } satisfies SecretRef;
      } else if (value === '') {
        if (isRef(old)) removals.push(old.ref);
      } else if (isRef(old)) {
        fields(rec)[field] = old;
      }
    }
    return removals;
  }

  const removeSecrets = async (refs: string[]) => {
    for (const ref of refs) await secrets!.remove(ref);
  };

  const secretRefs = (rec: Rec<T>) => secretFields.map((field) => fields(rec)[field]).filter(isRef).map((s) => s.ref);

  return {
    list: () => locked(async () => (await load()).map(masked)),
    get: (id) => locked(async () => masked(find(await load(), id))),
    create: (input) =>
      locked(async () => {
        const all = await load();
        if (all.length >= max) throw invalid('tooManyRecords', 'Too many records.');
        const now = new Date().toISOString();
        const rec = { ...opts.validate(input), id: crypto.randomUUID(), createdAt: now, updatedAt: now } as Rec<T>;
        await applySecrets(input, rec);
        await commit([...all, rec]);
        return masked(rec);
      }),
    update: (id, input) =>
      locked(async () => {
        const all = await load();
        const prev = find(all, id);
        const rec = { ...opts.validate(input, masked(prev)), id: prev.id, createdAt: prev.createdAt, updatedAt: new Date().toISOString() } as Rec<T>;
        const removals = await applySecrets(input, rec, prev);
        await commit(all.map((r) => (r === prev ? rec : r)));
        await removeSecrets(removals);
        return masked(rec);
      }),
    remove: (id) =>
      locked(async () => {
        const all = await load();
        const prev = find(all, id);
        await commit(all.filter((r) => r !== prev));
        await removeSecrets(secretRefs(prev));
      }),
    secret: (id, field) =>
      locked(async () => {
        if (!secretFields.includes(field)) throw new Error(`recordStore: ${field} is not a secret field`);
        const stored = fields(find(await load(), id))[field];
        return isRef(stored) ? secrets!.get(stored.ref) : null;
      }),
  };
}

/** `GET <base>`, `GET <base>/item?id=`, `POST <base>`, `PUT <base>?id=`, `DELETE <base>?id=` over a record store. */
export function recordRoutes<T extends object>(store: RecordStore<T>, base: string): Routes {
  const idOf = (query: URLSearchParams) => {
    const id = query.get('id');
    if (!id) throw invalid('missingId', 'Missing id.');
    return id;
  };
  return {
    [`GET ${base}`]: () => store.list(),
    [`GET ${base}/item`]: ({ query }) => store.get(idOf(query)),
    [`POST ${base}`]: async ({ json }) => store.create(await json()),
    [`PUT ${base}`]: async ({ query, json }) => store.update(idOf(query), await json()),
    [`DELETE ${base}`]: async ({ query }) => {
      await store.remove(idOf(query));
      return { ok: true };
    },
  };
}
