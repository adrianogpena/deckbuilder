import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PanelCtx } from './ctx.ts';
import { routes, runGit, safePath } from './changes.ts';

let dir: string;
let api: ReturnType<typeof routes>;

const call = (key: string, body: Record<string, unknown>) =>
  api[key]!({ query: new URLSearchParams(), json: async () => ({ project: 'p1', ...body }) } as never) as Promise<unknown>;
const git = async (...args: string[]) => (await runGit(dir, args)).stdout.trim();
const porcelain = () => git('status', '--porcelain');

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'chg-'));
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 't@t.t');
  await git('config', 'user.name', 't');
  await git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'init');
  api = routes({ projectRoot: (p) => (p === 'p1' ? dir : undefined) } as PanelCtx);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test('safePath refuses paths outside the project', () => {
  expect(safePath('src/a.ts')).toBe('src/a.ts');
  for (const bad of ['../x', 'a/../../x', '/abs', 'C:/x', '', 5]) expect(() => safePath(bad)).toThrow();
});

test('unknown project and bad paths are refused', async () => {
  await expect(call('POST /api/agents/git/stage', { project: 'nope', all: true })).rejects.toMatchObject({ code: 'projectNotFound' });
  await expect(call('POST /api/agents/git/stage', { paths: ['../x'] })).rejects.toMatchObject({ code: 'badPath' });
});

test('stage, commit, undo, discard', async () => {
  writeFileSync(join(dir, 'a.txt'), 'two\n');
  await call('POST /api/agents/git/stage', { paths: ['a.txt'] });
  expect(await porcelain()).toBe('M  a.txt');
  await call('POST /api/agents/git/unstage', { paths: ['a.txt'] });
  expect(await porcelain()).toBe('M a.txt');
  await call('POST /api/agents/git/stage', { all: true });
  await expect(call('POST /api/agents/git/commit', { message: ' ' })).rejects.toMatchObject({ code: 'emptyMessage' });
  await call('POST /api/agents/git/commit', { message: 'second' });
  expect(await git('log', '-1', '--format=%s')).toBe('second');
  await call('POST /api/agents/git/undo', {});
  expect(await git('log', '-1', '--format=%s')).toBe('init');
  expect(await porcelain()).toBe('M  a.txt');
  await call('POST /api/agents/git/commit', { message: 'second again' });
  writeFileSync(join(dir, 'a.txt'), 'three\n');
  writeFileSync(join(dir, 'new.txt'), 'x\n');
  await call('POST /api/agents/git/discard', { paths: ['a.txt'], untracked: ['new.txt'] });
  expect(await porcelain()).toBe('');
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('two\n');
});

test('stash and pop restore the edit', async () => {
  writeFileSync(join(dir, 'a.txt'), 'edited\n');
  await call('POST /api/agents/git/stash', {});
  expect(await porcelain()).toBe('');
  await call('POST /api/agents/git/stash', { pop: true });
  expect(await porcelain()).toBe('M a.txt');
  await call('POST /api/agents/git/discard', { paths: ['a.txt'] });
});

test('branches list, create and checkout; git errors carry stderr', async () => {
  await call('POST /api/agents/git/checkout', { branch: 'feature', create: true });
  const list = (await api['GET /api/agents/git/branches']!({ query: new URLSearchParams({ project: 'p1' }) } as never)) as { branches: Array<{ name: string; current: boolean }> };
  expect(list.branches).toEqual([
    { name: 'feature', current: true },
    { name: 'main', current: false },
  ]);
  await call('POST /api/agents/git/checkout', { branch: 'main' });
  expect(await git('branch', '--show-current')).toBe('main');
  await expect(call('POST /api/agents/git/checkout', { branch: 'missing' })).rejects.toMatchObject({ code: 'gitFailed' });
  await expect(call('POST /api/agents/git/checkout', { branch: '-x' })).rejects.toMatchObject({ code: 'badBranch' });
  await expect(call('POST /api/agents/git/push', {})).rejects.toMatchObject({ code: 'gitFailed' });
});
