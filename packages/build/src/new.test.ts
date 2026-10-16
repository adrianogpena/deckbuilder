import { afterAll, expect, test } from 'bun:test';
import { existsSync, lstatSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { appPackageJson, createApp, fillPlaceholders, serverViewsSource, validateNewApp, viewSettingsSource, viewSpecs, webViewsSource } from './new.ts';

test('defaults name and id from the folder', () => {
  expect(validateNewApp({ dir: 'my-tool' })).toEqual({ app: { dir: 'my-tool', name: 'My Tool', id: 'mytool' } });
});

test('takes explicit name and id', () => {
  expect(validateNewApp({ dir: 'my-tool', name: ' Tool ', id: 'tool' })).toEqual({ app: { dir: 'my-tool', name: 'Tool', id: 'tool' } });
});

test('rejects bad folder names and ids', () => {
  for (const dir of ['', 'My-Tool', '1tool', 'a_b', '../x', 'a/b']) expect('error' in validateNewApp({ dir })).toBe(true);
  expect('error' in validateNewApp({ dir: 'tool', id: 'My Tool' })).toBe(true);
  expect('error' in validateNewApp({ dir: 'tool', id: '1x' })).toBe(true);
});

test('rejects names that would break the app.ts string literal', () => {
  for (const name of ["a'b", '../x', 'a/b', 'a"b', 'a`b', 'a\\b', 'a\nb']) expect('error' in validateNewApp({ dir: 'tool', name })).toBe(true);
});

test('fills every placeholder', () => {
  const app = { dir: 'my-tool', name: 'My Tool', id: 'mytool' };
  expect(fillPlaceholders('__APP_NAME__ __APP_ID__ __APP_DIR__ __APP_DIR__-v', app)).toBe('My Tool mytool my-tool my-tool-v');
});

const ROOT = join(import.meta.dir, '..', '..', '..');
const GENERATED = join(ROOT, 'apps', 'zz-newtest');

/** Removes the generated app; the junction goes first so the gallery's node_modules is never followed. */
function removeGenerated(): void {
  const link = join(GENERATED, 'node_modules');
  if (lstatSync(link, { throwIfNoEntry: false })) unlinkSync(link);
  if (existsSync(link)) throw new Error(`could not remove the junction ${link}`);
  rmSync(GENERATED, { recursive: true, force: true });
}

afterAll(removeGenerated);

test('a generated app typechecks', async () => {
  removeGenerated();
  await createApp({ dir: 'zz-newtest', views: ['terminal'] }, join(ROOT, 'apps'));
  // The template's deps are a subset of the gallery's.
  symlinkSync(join(ROOT, 'apps', 'gallery', 'node_modules'), join(GENERATED, 'node_modules'), 'junction');
  for (const config of ['apps/zz-newtest/tsconfig.json', 'apps/zz-newtest/web/tsconfig.json']) {
    const r = Bun.spawnSync(['bun', 'x', 'tsc', '-p', config], { cwd: ROOT });
    expect({ config, out: r.stdout.toString(), exitCode: r.exitCode }).toEqual({ config, out: '', exitCode: 0 });
  }
}, 120_000);

const APP = { dir: 'my-tool', name: 'My Tool', id: 'mytool' };
const PKG = { scope: '@deckbuilderkit', version: '1.2.3', packagesDir: 'C:/repo/packages' };

test('published package.json depends on the current version of every package and chosen view', () => {
  const json = appPackageJson(APP, { views: ['terminal'], local: false }, PKG);
  expect(json.name).toBe('my-tool');
  expect(json.dependencies['@deckbuilderkit/ui']).toBe('1.2.3');
  expect(json.dependencies['@deckbuilderkit/view-terminal']).toBe('1.2.3');
  expect(json.devDependencies['@deckbuilderkit/build']).toBe('1.2.3');
  expect(JSON.stringify(json)).not.toContain('workspace:');
});

test('local package.json links the checkout packages', () => {
  const json = appPackageJson(APP, { views: ['terminal'], local: true }, PKG);
  expect(json.dependencies['@deckbuilderkit/ui']).toBe('link:C:/repo/packages/ui');
  expect(json.dependencies['@deckbuilderkit/view-terminal']).toBe('link:C:/repo/packages/view-terminal');
  expect(json.devDependencies['@deckbuilderkit/build']).toBe('link:C:/repo/packages/build');
});

test('only the chosen views are dependencies and imports', () => {
  const none = appPackageJson(APP, { views: [], local: false }, PKG);
  expect(Object.keys(none.dependencies).some((d) => d.includes('view-'))).toBe(false);
  expect(webViewsSource([], PKG.scope)).not.toContain('view-');
  expect(serverViewsSource([], PKG.scope)).not.toContain('view-');
});

test('generated view composition and merged Settings', () => {
  expect(webViewsSource(['terminal'], PKG.scope)).toContain("createViews([homeView, terminalView({ group: 'nav.section.main', order: 20 })]");
  expect(webViewsSource(['terminal'], PKG.scope)).toContain("from '@deckbuilderkit/view-terminal/web'");
  expect(serverViewsSource(['terminal'], PKG.scope)).toContain('terminalServerView({ integrationDir');
  expect(serverViewsSource(['terminal'], PKG.scope)).toContain('interface ViewSettings extends TerminalServerSettings {}');
  expect(viewSettingsSource(['terminal'], PKG.scope)).toContain('interface ViewSettings extends TerminalViewSettings {}');
  expect(viewSettingsSource([], PKG.scope)).toContain('interface ViewSettings {}');
});

test('rejects views that are unknown or need app glue', () => {
  expect(() => viewSpecs(['nope'])).toThrow('Unknown view');
  expect(() => viewSpecs(['git'])).toThrow('needs an app client');
});
