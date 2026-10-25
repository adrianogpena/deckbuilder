import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile, writeFileAtomic, writeJsonAtomic } from './json-file.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tmp() {
  const dir = await mkdtemp(join(tmpdir(), 'kedalion-json-'));
  dirs.push(dir);
  return dir;
}

test('20 concurrent writes leave valid JSON and no temp files', async () => {
  const dir = await tmp();
  const file = join(dir, 'sub', 'data.json');
  await Promise.all(Array.from({ length: 20 }, (_, n) => writeJsonAtomic(file, { n })));
  const text = await readFile(file, 'utf8');
  expect(text.endsWith('\n')).toBe(true);
  expect(JSON.parse(text)).toEqual({ n: 19 });
  expect(await readdir(join(dir, 'sub'))).toEqual(['data.json']);
});

test('writeFileAtomic writes text and bytes', async () => {
  const dir = await tmp();
  await writeFileAtomic(join(dir, 'a.txt'), 'hello');
  await writeFileAtomic(join(dir, 'b.bin'), new Uint8Array([1, 2, 3]));
  expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('hello');
  expect([...(await readFile(join(dir, 'b.bin')))]).toEqual([1, 2, 3]);
});

test('a failed write is reported and does not block the next one', async () => {
  const dir = await tmp();
  const file = join(dir, 'data.json');
  await writeFile(join(dir, 'blocker'), 'x');
  await expect(writeJsonAtomic(join(dir, 'blocker', 'data.json'), {})).rejects.toThrow();
  await writeJsonAtomic(file, { ok: true });
  expect(await readJsonFile(file)).toEqual({ ok: true });
});

test('a missing file reads as undefined', async () => {
  expect(await readJsonFile(join(await tmp(), 'none.json'))).toBeUndefined();
});

test('a directory in place of the file throws', async () => {
  await expect(readJsonFile(await tmp())).rejects.toThrow();
});

test('an unparsable file is renamed aside', async () => {
  const dir = await tmp();
  const file = join(dir, 'data.json');
  await writeFile(file, '{ nope');
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await readJsonFile(file)).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
  } finally {
    err.mockRestore();
  }
  const names = await readdir(dir);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^data\.json\.corrupt-\d+$/);
});

test('a value `accept` rejects is renamed aside too', async () => {
  const dir = await tmp();
  const file = join(dir, 'data.json');
  await writeFile(file, '[1]');
  const err = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await readJsonFile(file, (v) => typeof v === 'object' && !Array.isArray(v))).toBeUndefined();
  } finally {
    err.mockRestore();
  }
  expect((await readdir(dir))[0]).toMatch(/^data\.json\.corrupt-/);
});
