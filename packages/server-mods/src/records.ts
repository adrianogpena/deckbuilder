import { join } from 'node:path';
import { readJsonFile, writeJsonAtomic } from '@deckbuilder/platform';
import { AppError, invalid, notFound, type Routes } from '@deckbuilder/server-core';
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
  /**
   * Builds a fresh `T` from raw client input (never spread the input) and throws `invalid(...)`;
   * `prev` is set on update, `ctx.imported` when the input comes from a backup file the user
   * picked in a native dialog (`importItems`) rather than from a form.
   */
  validate(input: unknown, prev?: Rec<T>, ctx?: { imported?: true }): T;
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
  /**
   * Adds or updates records by id from a backup, in one write. Imports never change secrets: an
   * updated record keeps its stored ones, an added one has none. `replace` also removes the
   * records whose id is not in `items`.
   */
  importItems(items: unknown[], mode: 'merge' | 'replace'): Promise<ImportResult>;
  /** Every record without its secret fields (not even the `hasSecret` marker), for a backup. */
  exportItems(): Promise<Rec<T>[]>;
}

export interface ImportResult {
  added: number;
  updated: number;
  removed: number;
  skipped: Array<{ id?: string; code: string; message: string }>;
}

interface RecordFile<T> {
  version: 1;
  items: Rec<T>[];
}

/** Longest secret field value, in characters; the secret store is rewritten on every set. */
const MAX_SECRET_LENGTH = 65_536;

/** What a secret field holds in the file. */
interface SecretRef {
  ref: string;
}

const isRef = (v: unknown): v is SecretRef => typeof v === 'object' && v !== null && typeof (v as SecretRef).ref === 'string';

const IMPORT_ID = /^[\w-]{1,64}$/;

const isValidDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

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
    for (const field of secretFields) {
      const value = raw[field];
      if (typeof value === 'string' && value.length > MAX_SECRET_LENGTH) throw invalid('secretTooLong', 'The secret is too long.');
    }
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
    importItems: (list, mode) =>
      locked(async () => {
        const all = await load();
        const result: ImportResult = { added: 0, updated: 0, removed: 0, skipped: [] };
        const skip = (id: string | undefined, code: string, message: string) => result.skipped.push({ ...(id && { id }), code, message });
        const valid: Array<{ id: string; item: Record<string, unknown> }> = [];
        const ids = new Set<string>();
        for (const item of list) {
          const id = typeof item === 'object' && item !== null ? (item as Record<string, unknown>).id : undefined;
          if (typeof id !== 'string' || !IMPORT_ID.test(id)) skip(undefined, 'badRecord', 'Invalid record.');
          else if (ids.has(id)) skip(id, 'badRecord', 'Invalid record.');
          else {
            ids.add(id);
            valid.push({ id, item: item as Record<string, unknown> });
          }
        }
        const kept = mode === 'merge' ? all : all.filter((r) => ids.has(r.id));
        const updates = new Map<string, Rec<T>>();
        const added: Rec<T>[] = [];
        const now = new Date().toISOString();
        for (const { id, item } of valid) {
          const { id: _id, createdAt, updatedAt: _updatedAt, ...input } = item;
          for (const field of secretFields) delete input[field];
          const prev = all.find((r) => r.id === id);
          if (!prev && kept.length + added.length >= max) {
            skip(id, 'tooManyRecords', 'Too many records.');
            continue;
          }
          let value: T;
          try {
            value = opts.validate(input, prev && masked(prev), { imported: true });
          } catch (e) {
            if (!(e instanceof AppError)) throw e;
            skip(id, e.code, e.message);
            continue;
          }
          if (prev) {
            const rec = { ...value, id, createdAt: prev.createdAt, updatedAt: now } as Rec<T>;
            await applySecrets(input, rec, prev);
            updates.set(id, rec);
          } else {
            const rec = { ...value, id, createdAt: isValidDate(createdAt) ? new Date(createdAt).toISOString() : now, updatedAt: now } as Rec<T>;
            for (const field of secretFields) delete fields(rec)[field];
            added.push(rec);
          }
        }
        const removed = all.filter((r) => !kept.includes(r));
        await commit([...kept.map((r) => updates.get(r.id) ?? r), ...added]);
        await removeSecrets(removed.flatMap(secretRefs));
        return { ...result, added: added.length, updated: updates.size, removed: removed.length };
      }),
    exportItems: () =>
      locked(async () =>
        (await load()).map((rec) => {
          const copy = fields(structuredClone(rec));
          for (const field of secretFields) delete copy[field];
          return copy as unknown as Rec<T>;
        }),
      ),
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
