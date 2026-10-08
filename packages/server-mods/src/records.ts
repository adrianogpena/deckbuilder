import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@deckbuilder/platform';
import { invalid, notFound, type Routes } from '@deckbuilder/server-core';

/** A stored record: the app's fields plus the ones the store owns. */
export type Rec<T> = T & { id: string; createdAt: string; updatedAt: string };

/** Where secret field values live instead of the JSON file (implemented in batch 09). */
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
  secretFields?: string[];
  secrets?: SecretBackend;
}

export interface RecordStore<T extends object> {
  list(): Promise<Rec<T>[]>;
  get(id: string): Promise<Rec<T>>;
  create(input: unknown): Promise<Rec<T>>;
  update(id: string, input: unknown): Promise<Rec<T>>;
  remove(id: string): Promise<void>;
}

interface RecordFile<T> {
  version: 1;
  items: Rec<T>[];
}

const isRecordFile = (v: unknown) =>
  typeof v === 'object' && v !== null && (v as RecordFile<object>).version === 1 && Array.isArray((v as RecordFile<object>).items);

/** A JSON-file store of records with ids and timestamps; calls are serialized so concurrent ones never lose a record. */
export function recordStore<T extends object>(opts: RecordStoreOptions<T>): RecordStore<T> {
  if (opts.secretFields?.length) throw new Error('recordStore: secretFields are wired in batch 09');
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

  return {
    list: () => locked(async () => structuredClone(await load())),
    get: (id) => locked(async () => structuredClone(find(await load(), id))),
    create: (input) =>
      locked(async () => {
        const all = await load();
        if (all.length >= max) throw invalid('tooManyRecords', 'Too many records.');
        const now = new Date().toISOString();
        const rec = { ...opts.validate(input), id: crypto.randomUUID(), createdAt: now, updatedAt: now } as Rec<T>;
        await commit([...all, rec]);
        return structuredClone(rec);
      }),
    update: (id, input) =>
      locked(async () => {
        const all = await load();
        const prev = find(all, id);
        const rec = { ...opts.validate(input, prev), id: prev.id, createdAt: prev.createdAt, updatedAt: new Date().toISOString() } as Rec<T>;
        await commit(all.map((r) => (r === prev ? rec : r)));
        return structuredClone(rec);
      }),
    remove: (id) =>
      locked(async () => {
        const all = await load();
        const prev = find(all, id);
        await commit(all.filter((r) => r !== prev));
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
