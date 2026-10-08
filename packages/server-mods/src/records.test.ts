import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformError } from '@deckbuilder/platform';
import { AppError, invalid } from '@deckbuilder/server-core';
import { type Rec, recordRoutes, recordStore } from './records.ts';

interface Item {
  title: string;
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function validate(input: unknown): Item {
  const raw = (input ?? {}) as Record<string, unknown>;
  if (typeof raw.title !== 'string' || !raw.title) throw invalid('badTitle', 'Title required.');
  return { title: raw.title };
}

async function setup(max?: number) {
  const dir = await mkdtemp(join(tmpdir(), 'deckbuilder-records-'));
  dirs.push(dir);
  return { dir, store: recordStore<Item>({ dir, name: 'items', validate, max }) };
}

test('create, list, get, update and remove', async () => {
  const { dir, store } = await setup();
  const a = await store.create({ title: 'a', id: 'forged', extra: 1 });
  expect(a).toMatchObject({ title: 'a' });
  expect(a.id).not.toBe('forged');
  expect(a).not.toHaveProperty('extra');
  expect(a.createdAt).toBe(a.updatedAt);
  const b = await store.create({ title: 'b' });
  expect((await store.list()).map((r) => r.title)).toEqual(['a', 'b']);
  expect(await store.get(b.id)).toEqual(b);

  await Bun.sleep(5);
  const a2 = await store.update(a.id, { title: 'a2' });
  expect(a2).toMatchObject({ id: a.id, title: 'a2', createdAt: a.createdAt });
  expect(a2.updatedAt > a.updatedAt).toBe(true);

  await store.remove(a.id);
  expect((await store.list()).map((r) => r.title)).toEqual(['b']);
  const saved = JSON.parse(await readFile(join(dir, 'items.json'), 'utf8'));
  expect(saved.version).toBe(1);
  expect(saved.items).toHaveLength(1);
});

test('a fresh store reads what an earlier one saved', async () => {
  const { dir, store } = await setup();
  const a = await store.create({ title: 'a' });
  const again = recordStore<Item>({ dir, name: 'items', validate });
  expect(await again.get(a.id)).toEqual(a);
});

test('validate rejections surface as invalid AppErrors and store nothing', async () => {
  const { store } = await setup();
  const err = await store.create({}).catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect(err).toMatchObject({ kind: 'invalid', code: 'badTitle' });
  expect(await store.list()).toEqual([]);
});

test('update passes the previous record to validate', async () => {
  const { dir } = await setup();
  const seen: Array<Rec<Item> | undefined> = [];
  const store = recordStore<Item>({
    dir,
    name: 'seen',
    validate: (input, prev) => {
      seen.push(prev);
      return validate(input);
    },
  });
  const a = await store.create({ title: 'a' });
  await store.update(a.id, { title: 'b' });
  expect(seen[0]).toBeUndefined();
  expect(seen[1]?.id).toBe(a.id);
});

test('max is enforced', async () => {
  const { store } = await setup(2);
  await store.create({ title: 'a' });
  await store.create({ title: 'b' });
  expect(await store.create({ title: 'c' }).catch((e) => e)).toMatchObject({ kind: 'invalid', code: 'tooManyRecords' });
});

test('an unknown id is notFound', async () => {
  const { store } = await setup();
  for (const call of [() => store.get('x'), () => store.update('x', { title: 'a' }), () => store.remove('x')]) {
    expect(await call().catch((e) => e)).toMatchObject({ kind: 'notfound', code: 'recordNotFound' });
  }
});

test('concurrent creates are all persisted', async () => {
  const { dir, store } = await setup();
  await Promise.all(Array.from({ length: 20 }, (_, n) => store.create({ title: `t${n}` })));
  expect(await store.list()).toHaveLength(20);
  const again = recordStore<Item>({ dir, name: 'items', validate });
  expect(await again.list()).toHaveLength(20);
  expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
});

test('secretFields need the secrets option', async () => {
  const { dir } = await setup();
  expect(() => recordStore<Item>({ dir, name: 'items', validate, secretFields: ['password'] })).toThrow('secrets option');
});

function fakeSecrets() {
  const values = new Map<string, string>();
  return {
    values,
    set: async (ref: string, value: string) => void values.set(ref, value),
    get: async (ref: string) => values.get(ref) ?? null,
    remove: async (ref: string) => void values.delete(ref),
  };
}

async function secretSetup() {
  const { dir } = await setup();
  const secrets = fakeSecrets();
  const store = recordStore<Item>({ dir, name: 'conns', validate, secretFields: ['password'], secrets });
  return { dir, secrets, store };
}

test('secret fields never leave the store, secret() reads them', async () => {
  const { dir, secrets, store } = await secretSetup();
  const a = await store.create({ title: 'a', password: 'hunter2' });
  const b = await store.create({ title: 'b' });
  expect(a).toMatchObject({ password: { hasSecret: true } });
  expect(b).not.toHaveProperty('password');
  const shown = JSON.stringify([await store.list(), await store.get(a.id)]);
  expect(shown).not.toContain('hunter2');
  expect(shown).not.toContain('"ref"');
  expect(await readFile(join(dir, 'conns.json'), 'utf8')).not.toContain('hunter2');
  expect(await store.secret(a.id, 'password')).toBe('hunter2');
  expect(await store.secret(b.id, 'password')).toBeNull();
  expect(secrets.values.size).toBe(1);

  const routes = recordRoutes(store, '/api/conns');
  const ctx = { query: new URLSearchParams(`id=${a.id}`), json: async () => ({}) } as unknown as Parameters<(typeof routes)[string]>[0];
  expect(JSON.stringify([await routes['GET /api/conns']!(ctx), await routes['GET /api/conns/item']!(ctx)])).not.toContain('hunter2');
});

test('update: absent or hasSecret keeps the secret, a string replaces it, empty clears it', async () => {
  const { secrets, store } = await secretSetup();
  const a = await store.create({ title: 'a', password: 'one' });
  await store.update(a.id, { title: 'b' });
  expect(await store.secret(a.id, 'password')).toBe('one');
  await store.update(a.id, { title: 'c', password: { hasSecret: true } });
  expect(await store.secret(a.id, 'password')).toBe('one');
  await store.update(a.id, { title: 'd', password: 'two' });
  expect(await store.secret(a.id, 'password')).toBe('two');
  const cleared = await store.update(a.id, { title: 'e', password: '' });
  expect(cleared).not.toHaveProperty('password');
  expect(await store.secret(a.id, 'password')).toBeNull();
  expect(secrets.values.size).toBe(0);
});

test('a secret over 65 536 characters is refused before anything is stored', async () => {
  const { secrets, store } = await secretSetup();
  const sets: string[] = [];
  const set = secrets.set;
  secrets.set = async (ref, value) => {
    sets.push(ref);
    await set(ref, value);
  };
  expect(await store.create({ title: 'a', password: 'x'.repeat(65_537) }).catch((e) => e)).toMatchObject({ kind: 'invalid', code: 'secretTooLong' });
  expect(sets).toEqual([]);
  expect(await store.list()).toEqual([]);
});

test('remove deletes the secrets of the record', async () => {
  const { secrets, store } = await secretSetup();
  const a = await store.create({ title: 'a', password: 'x' });
  await store.remove(a.id);
  expect(secrets.values.size).toBe(0);
});

test('a PlatformError from the secret backend becomes an invalid AppError', async () => {
  const { dir } = await setup();
  const failing = {
    ...fakeSecrets(),
    set: async () => {
      throw new PlatformError('secretsUnavailable', 'The secret store is not available.', 'no tool');
    },
  };
  const store = recordStore<Item>({ dir, name: 'conns', validate, secretFields: ['password'], secrets: failing });
  const err = await store.create({ title: 'a', password: 'x' }).catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect(err.toJSON()).toMatchObject({ kind: 'invalid', code: 'secretsUnavailable', detail: 'no tool' });
  expect(await store.list()).toEqual([]);
});

test('routes map the store, ids come from the query', async () => {
  const { store } = await setup();
  const routes = recordRoutes(store, '/api/things');
  const ctx = (query = '', body: unknown = {}) =>
    ({ query: new URLSearchParams(query), json: async () => body }) as unknown as Parameters<(typeof routes)[string]>[0];

  const created = (await routes['POST /api/things']!(ctx('', { title: 'a' }))) as Rec<Item>;
  expect(await routes['GET /api/things']!(ctx())).toEqual([created]);
  expect(await routes['GET /api/things/item']!(ctx(`id=${created.id}`))).toEqual(created);
  expect(await routes['PUT /api/things']!(ctx(`id=${created.id}`, { title: 'b' }))).toMatchObject({ title: 'b' });
  expect(await routes['DELETE /api/things']!(ctx(`id=${created.id}`))).toEqual({ ok: true });
  await expect(routes['DELETE /api/things']!(ctx()) as Promise<unknown>).rejects.toMatchObject({ code: 'missingId' });
});
