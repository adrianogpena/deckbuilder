import { expect, test } from 'bun:test';
import { isRunnable, openWithDefault } from './files.ts';

test('isRunnable flags runnable extensions, case-insensitively', () => {
  for (const name of ['a.EXE', 'x.lnk', 'run.ps1', 'C:/dir/setup.Msi', 'app.appref-ms']) expect(isRunnable(name)).toBe(true);
  for (const name of ['notes.md', 'data.json', 'q.sql', 'README', 'dir.exe/file.txt']) expect(isRunnable(name)).toBe(false);
});

test('openWithDefault refuses runnable files', async () => {
  expect(await openWithDefault('C:/x/evil.bat').catch((e) => e)).toMatchObject({ code: 'openRefused' });
});
