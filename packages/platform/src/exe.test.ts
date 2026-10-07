import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { isCompiledExe, removeOldExe, updatePaths } from './exe.ts';

const EXE = join('C:\\apps', 'gallery.exe');

test('update paths sit next to the exe and keep its extension', () => {
  expect(updatePaths(EXE)).toEqual({ fresh: join('C:\\apps', 'gallery.new.exe'), old: join('C:\\apps', 'gallery.old.exe') });
  expect(updatePaths('/opt/gallery')).toEqual({ fresh: join('/opt', 'gallery.new'), old: join('/opt', 'gallery.old') });
});

test('bun and node are not compiled exes', () => {
  expect(isCompiledExe('C:/tools/bun.exe')).toBe(false);
  expect(isCompiledExe('/usr/bin/node')).toBe(false);
  expect(isCompiledExe(EXE)).toBe(true);
});

test('removeOldExe waits until the old process lets go of its exe', async () => {
  let busy = 3;
  const removed: string[] = [];
  const remove = async (path: string) => {
    if (busy-- > 0) throw new Error('EBUSY');
    removed.push(path);
  };
  expect(await removeOldExe(EXE, { remove, sleep: async () => {} })).toBe(true);
  expect(removed).toEqual([updatePaths(EXE).old]);

  const stuck = async () => {
    throw new Error('EBUSY');
  };
  expect(await removeOldExe(EXE, { remove: stuck, sleep: async () => {}, timeoutMs: 1000 })).toBe(false);
});
