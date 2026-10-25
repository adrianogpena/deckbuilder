import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listArchive, parseListing, run } from './archive.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('run with maxPaths stops keeping listing output past the cap and marks it capped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'arc-cap-'));
  dirs.push(dir);
  for (const n of ['a', 'b', 'c']) await writeFile(join(dir, `${n}.txt`), n);
  expect((await run(['a', '-bd', '/host/t.zip', '/host/a.txt', '/host/b.txt', '/host/c.txt'], { '/host': dir })).code).toBe(0);
  const all = await run(['l', '-slt', '-ba', '-bd', '/host/t.zip'], { '/host': dir }, undefined, 3);
  expect(parseListing(all.out)).toHaveLength(3);
  expect(all.capped).toBeUndefined();
  const cut = await run(['l', '-slt', '-ba', '-bd', '/host/t.zip'], { '/host': dir }, undefined, 2);
  expect(parseListing(cut.out)).toHaveLength(2);
  expect(cut.capped).toBe(true);
});

test('parseListing reads 7z -slt blocks, with progress text before the first Path', () => {
  const lines = [
    '  0M Scan /host/                Path = d',
    'Size = 0',
    'Attributes = D',
    'Modified = 2026-10-09 23:10:45.2348240',
    '',
    'Path = d\\b.txt',
    'Size = 2',
    'Attributes = A',
    'Encrypted = +',
    '',
  ];
  expect(parseListing(lines)).toEqual([
    { path: 'd', dir: true, size: 0, mtime: Date.parse('2026-10-09T23:10:45Z'), encrypted: false },
    { path: 'd/b.txt', dir: false, size: 2, mtime: 0, encrypted: true },
  ]);
});

test('listArchive lists a gzip file and refuses a file that is no archive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kedalion-arc-'));
  dirs.push(dir);
  await writeFile(join(dir, 'note.txt.gz'), Bun.gzipSync('hello'));
  await writeFile(join(dir, 'plain.zip'), 'not an archive');
  const listing = await listArchive(join(dir, 'note.txt.gz'));
  expect(listing.entries.map((e) => [e.path, e.size])).toEqual([['note.txt', 5]]);
  await expect(listArchive(join(dir, 'plain.zip'))).rejects.toMatchObject({ code: 'badArchive' });
});
