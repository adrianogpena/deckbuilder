import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, releaseNotes } from './release.ts';

const dir = mkdtempSync(join(tmpdir(), 'deckbuilder-release-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const app = { dir, name: 'My Tool', id: 'mytool', version: '1.2.0' };
const sha256 = (text: string) => new Bun.CryptoHasher('sha256').update(text).digest('hex');

test('buildManifest labels each exe by its file name and hashes it', async () => {
  const win = join(dir, 'My-Tool-1.2.0-windows-x64.exe');
  const linux = join(dir, 'My-Tool-1.2.0-linux-x64');
  writeFileSync(win, 'win');
  writeFileSync(linux, 'linux');
  const manifest = await buildManifest(app, [win, linux], '- notes');
  expect(manifest).toMatchObject({ version: '1.2.0', notes: '- notes' });
  expect(manifest.files).toEqual({
    'windows-x64': { file: 'My-Tool-1.2.0-windows-x64.exe', sha256: sha256('win') },
    'linux-x64': { file: 'My-Tool-1.2.0-linux-x64', sha256: sha256('linux') },
  });
});

test('buildManifest refuses a file of another app or version', async () => {
  const other = join(dir, 'My-Tool-1.1.0-windows-x64.exe');
  writeFileSync(other, 'old');
  await expect(buildManifest(app, [other], '')).rejects.toThrow('does not start with');
});

const fakeGit = (tag: string | null, log: string) => {
  const calls: string[][] = [];
  const git = (args: string[]) => {
    calls.push(args);
    if (args[0] === 'describe') {
      if (tag === null) throw new Error('no tags');
      return tag;
    }
    return log;
  };
  return { git, calls };
};

test('releaseNotes lists commits since the previous tag, without release commits', () => {
  const { git, calls } = fakeGit('tool-v1.1.0', 'Add x\nRelease tool-v1.1.0\nFix y');
  expect(releaseNotes(git, 'tool-v', '1.2.0')).toBe('- Add x\n- Fix y');
  expect(calls[0]).toContain('--exclude');
  expect(calls[0]).toContain('tool-v1.2.0');
  expect(calls[1]).toContain('tool-v1.1.0..HEAD');
});

test('releaseNotes for a first release and for a release without commits', () => {
  expect(releaseNotes(fakeGit(null, '').git, 'tool-v', '0.1.0')).toBe('- First release');
  expect(releaseNotes(fakeGit('tool-v1.1.0', 'Release tool-v1.1.0').git, 'tool-v', '1.2.0')).toBe('- Maintenance release');
});
