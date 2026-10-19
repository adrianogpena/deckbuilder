import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLayoutStore, isSavedLayout } from './layouts.ts';

const layout = {
  focused: 'p1',
  panes: [{ id: 'p1', active: 't1', tabs: [{ id: 't1', route: { kind: 'terminal', params: { session: 's1' } } }, { id: 't2', route: { kind: 'future-kind', params: {} } }] }],
};

const dirOf = () => join(mkdtempSync(join(tmpdir(), 'agents-layouts-')), 'layouts');

test('a layout round-trips per project', async () => {
  const dir = dirOf();
  const s = createLayoutStore(dir);
  expect(await s.read('C:/a')).toBeUndefined();
  expect(await s.write('C:/a', layout)).toBe(true);
  expect(await s.write('C:/b', { ...layout, focused: 'p9' })).toBe(true);
  expect(await createLayoutStore(dir).read('C:/a')).toEqual(layout);
  expect((await s.read('C:/b'))?.focused).toBe('p9');
  expect(s.fileOf('C:/a')).not.toBe(s.fileOf('C:/b'));
});

test('path spelling does not split a project', () => {
  const s = createLayoutStore(dirOf());
  expect(s.fileOf('C:\\Work\\App\\')).toBe(s.fileOf('c:/work/app'));
});

test('a bad file reads as no layout and is set aside', async () => {
  const dir = dirOf();
  const s = createLayoutStore(dir);
  await s.write('C:/a', layout);
  writeFileSync(s.fileOf('C:/a'), '{ not json');
  expect(await s.read('C:/a')).toBeUndefined();
  expect(existsSync(s.fileOf('C:/a'))).toBe(false);
  expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
});

test('a file with the wrong shape reads as no layout', async () => {
  const dir = dirOf();
  const s = createLayoutStore(dir);
  await s.write('C:/a', layout);
  writeFileSync(s.fileOf('C:/a'), JSON.stringify({ layout: { panes: [{ id: 'p', tabs: [{ id: 't', route: { kind: 3 } }] }] } }));
  expect(await s.read('C:/a')).toBeUndefined();
});

test('write refuses what is not a layout', async () => {
  const s = createLayoutStore(dirOf());
  expect(await s.write('', layout)).toBe(false);
  expect(await s.write('C:/a', { panes: [] })).toBe(false);
  expect(await s.write('C:/a', 'x')).toBe(false);
  expect(isSavedLayout({ panes: [{ id: 'p', tabs: [{ id: 't', route: { kind: 'x', params: [] } }] }] })).toBe(false);
});
