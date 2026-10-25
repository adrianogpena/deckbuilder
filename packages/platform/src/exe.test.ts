import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { isCompiledExe } from './exe.ts';

test('bun and node are not compiled exes', () => {
  expect(isCompiledExe('C:/tools/bun.exe')).toBe(false);
  expect(isCompiledExe('/usr/bin/node')).toBe(false);
  expect(isCompiledExe(join('C:\\apps', 'gallery.exe'))).toBe(true);
});
