import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectTargets, findUrl } from './run-detect.ts';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'run-detect-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const put = (name: string, text = '') => writeFile(join(dir, name), text);

test('package.json scripts use the manager of the lockfile', async () => {
  await put('package.json', JSON.stringify({ scripts: { dev: 'vite', build: 'tsc' } }));
  expect((await detectTargets(dir)).map((x) => x.cmd)).toEqual([['npm', 'run', 'dev'], ['npm', 'run', 'build']]);
  await put('bun.lock');
  expect((await detectTargets(dir))[0]!.cmd).toEqual(['bun', 'run', 'dev']);
  await rm(join(dir, 'bun.lock'));
  await put('pnpm-lock.yaml');
  expect((await detectTargets(dir))[0]!.cmd).toEqual(['pnpm', 'run', 'dev']);
});

test('other stacks are detected by their build file', async () => {
  for (const f of ['go.mod', 'Cargo.toml', 'App.csproj', 'manage.py', 'pom.xml', 'build.gradle.kts', 'compose.yaml']) await put(f);
  const cmds = (await detectTargets(dir)).map((x) => x.cmd.join(' '));
  expect(cmds).toEqual([
    'go run .',
    'cargo run',
    'dotnet run --project App.csproj',
    'python manage.py runserver',
    'mvn spring-boot:run',
    'gradle bootRun',
    'docker compose -f compose.yaml up',
  ]);
});

test('an empty, missing or broken folder gives no targets', async () => {
  expect(await detectTargets(dir)).toEqual([]);
  expect(await detectTargets(join(dir, 'nope'))).toEqual([]);
  await put('package.json', '{ nope');
  expect(await detectTargets(dir)).toEqual([]);
});

test('findUrl takes the first local URL and ignores colors', () => {
  expect(findUrl('ready\n  Local: \u001b[36mhttp://localhost:5173/\u001b[0m')).toBe('http://localhost:5173/');
  expect(findUrl('listening on http://0.0.0.0:3000.')).toBe('http://localhost:3000');
  expect(findUrl('see https://example.com:443')).toBeUndefined();
});
