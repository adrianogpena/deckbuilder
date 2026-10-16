import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchLatestVersion, upgradeApp } from './upgrade.ts';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function app(pkg: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'deckbuilder-upgrade-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

test('fetchLatestVersion reads dist-tags.latest', async () => {
  const fake = (async () => new Response(JSON.stringify({ 'dist-tags': { latest: '0.3.0' } }))) as unknown as typeof fetch;
  expect(await fetchLatestVersion(fake)).toBe('0.3.0');
});

test('upgradeApp bumps published deps together, leaves link: and workspace: alone, then installs', async () => {
  const dir = app({
    dependencies: { '@deckbuilderkit/ui': '0.1.2', '@deckbuilderkit/shell': 'link:@deckbuilderkit/shell', react: '^18.3.1' },
    devDependencies: { '@deckbuilderkit/build': '0.1.2', '@deckbuilderkit/db': 'workspace:*' },
  });
  const installed: string[] = [];
  const result = await upgradeApp(dir, { fetchLatest: async () => '0.2.0', install: (d) => void installed.push(d) });
  const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  expect(json.dependencies['@deckbuilderkit/ui']).toBe('0.2.0');
  expect(json.devDependencies['@deckbuilderkit/build']).toBe('0.2.0');
  expect(json.dependencies['@deckbuilderkit/shell']).toBe('link:@deckbuilderkit/shell');
  expect(json.devDependencies['@deckbuilderkit/db']).toBe('workspace:*');
  expect(json.dependencies.react).toBe('^18.3.1');
  expect(result.skipped.sort()).toEqual(['@deckbuilderkit/db', '@deckbuilderkit/shell']);
  expect(installed).toEqual([dir]);
});

test('upgradeApp skips the install when every dep is linked', async () => {
  const dir = app({ dependencies: { '@deckbuilderkit/ui': 'link:@deckbuilderkit/ui' } });
  let installs = 0;
  const result = await upgradeApp(dir, { fetchLatest: async () => '0.2.0', install: () => void installs++ });
  expect(result.updated).toEqual([]);
  expect(installs).toBe(0);
});
