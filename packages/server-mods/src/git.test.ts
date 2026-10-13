import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunResult } from '@deckbuilder/platform';
import { gitRoutes, parsePorcelainV2 } from './git.ts';

const done = (stdout: string, code = 0, stderr = ''): RunResult => ({ kind: 'done', code, stdout, stderr });
const roots = async () => [{ id: 'r1', path: 'C:/proj' }];
const q = (o: Record<string, string>) => ({ query: new URLSearchParams(o) }) as never;

test('parsePorcelainV2 reads branch headers', () => {
  const out = parsePorcelainV2('# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0');
  expect(out).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, files: [] });
});

test('parsePorcelainV2 splits staged and unstaged entries of one file', () => {
  const out = parsePorcelainV2('1 MM N... 100644 100644 100644 h1 h2 src/a b.ts\0');
  expect(out.files).toEqual([
    { path: 'src/a b.ts', index: 'M', worktree: 'M', group: 'staged' },
    { path: 'src/a b.ts', index: 'M', worktree: 'M', group: 'unstaged' },
  ]);
});

test('parsePorcelainV2 reads renames, conflicts, untracked and skips ignored', () => {
  const out = parsePorcelainV2(
    ['2 R. N... 100644 100644 100644 h1 h2 R100 új.ts', 'old.ts', 'u UU N... 1 2 3 4 h1 h2 h3 c.ts', '? ñ/new file.txt', '! ignored.log', ''].join('\0'),
  );
  expect(out.files).toEqual([
    { path: 'új.ts', origPath: 'old.ts', index: 'R', worktree: '.', group: 'staged' },
    { path: 'c.ts', index: 'U', worktree: 'U', group: 'conflict' },
    { path: 'ñ/new file.txt', index: '?', worktree: '?', group: 'untracked' },
  ]);
});

test('routes refuse an unknown root and a bad path', async () => {
  const routes = gitRoutes({ roots, run: async () => done('') });
  await expect(routes['GET /api/git/status']!(q({ root: 'nope' }))).rejects.toMatchObject({ code: 'rootNotFound' });
  await expect(routes['GET /api/git/diff']!(q({ root: 'r1', path: '../x' }))).rejects.toMatchObject({ code: 'badPath' });
  await expect(routes['GET /api/git/file']!(q({ root: 'r1', path: '', from: 'head' }))).rejects.toMatchObject({ code: 'badPath' });
});

test('status maps timeout, missing git and not a repo', async () => {
  const status = (run: Parameters<typeof gitRoutes>[0]['run']) => gitRoutes({ roots, run })['GET /api/git/status']!(q({ root: 'r1' }));
  await expect(status(async () => ({ kind: 'timeout' }))).rejects.toMatchObject({ code: 'gitTimeout' });
  await expect(status(async () => done('', 128, 'fatal: not a git repository'))).rejects.toMatchObject({ code: 'notARepo' });
  await expect(status(async () => done('', 128, 'fatal: detected dubious ownership'))).rejects.toMatchObject({ code: 'gitDubiousOwnership' });
  await expect(
    status(async () => {
      throw new Error('ENOENT');
    }),
  ).rejects.toMatchObject({ code: 'gitMissing' });
});

test('status strips the repo prefix and scopes every call', async () => {
  const calls: string[][] = [];
  const run = async (cmd: string[]) => {
    calls.push(cmd);
    if (cmd.includes('rev-parse')) return done('C:/repo\nsub/dir/\n');
    return done('# branch.head main\0? sub/dir/a.txt\0');
  };
  const out = await gitRoutes({ roots, run })['GET /api/git/status']!(q({ root: 'r1' }));
  expect(out).toMatchObject({ branch: 'main', files: [{ path: 'a.txt', group: 'untracked' }] });
  expect(calls[0]!.slice(0, 7)).toEqual(['git', '--no-optional-locks', '-c', 'core.quotepath=off', '-C', 'C:/proj', 'status']);
  expect(calls[0]!.slice(-2)).toEqual(['--', '.']);
});

test('repos reports a folder outside a repo', async () => {
  const run = async () => done('', 128, 'fatal: not a git repository');
  expect(await gitRoutes({ roots, run })['GET /api/git/repos']!(q({}))).toEqual([{ root: 'r1', repo: false }]);
});

test.skipIf(Bun.which('git') === null)('live repo: status, file and diff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'git-test-'));
  try {
    const sh = (...args: string[]) => Bun.spawnSync(['git', '-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
    sh('init');
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    sh('add', '.');
    sh('commit', '-m', 'init');
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    writeFileSync(join(dir, 'b.txt'), 'new\n');
    const routes = gitRoutes({ roots: async () => [{ id: 'd', path: dir }] });
    const status = (await routes['GET /api/git/status']!(q({ root: 'd' }))) as { files: Array<{ path: string; group: string }> };
    expect(status.files.map((f) => `${f.group}:${f.path}`).sort()).toEqual(['unstaged:a.txt', 'untracked:b.txt']);
    expect(await routes['GET /api/git/file']!(q({ root: 'd', path: 'a.txt', from: 'head' }))).toEqual({ text: 'one\n' });
    expect(await routes['GET /api/git/file']!(q({ root: 'd', path: 'b.txt', from: 'head' }))).toEqual({ missing: true });
    const diff = (await routes['GET /api/git/diff']!(q({ root: 'd', path: 'a.txt' }))) as { text: string };
    expect(diff.text).toContain('+two');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
