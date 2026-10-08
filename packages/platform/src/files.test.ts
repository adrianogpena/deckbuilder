import { expect, test } from 'bun:test';
import { isOpenable, openArgv, openWithDefault } from './files.ts';

test('isOpenable allows documents, images and media only, case-insensitively', () => {
  for (const name of ['notes.md', 'C:/d/A.PNG', 'r.docx']) expect(isOpenable(name)).toBe(true);
  for (const name of ['x.py', 'a.exe', 'm.xlsm', 'p.svg', 'README']) expect(isOpenable(name)).toBe(false);
});

test('openWithDefault refuses files that are not openable', async () => {
  expect(await openWithDefault('C:/x/s.py').catch((e) => e)).toMatchObject({ code: 'openRefused' });
});

test('openArgv quotes the path for explorer.exe', () => {
  expect(openArgv('C:\p\run.cmd,a.txt', 'win32')).toEqual({ argv: ['explorer.exe', '"C:\p\run.cmd,a.txt"'], verbatim: true });
});
