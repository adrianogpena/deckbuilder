import { afterAll, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { addView, validateViewId, viewNames } from './add-view.ts';

const REPO = join(import.meta.dir, '..', '..', '..');
const root = mkdtempSync(join(tmpdir(), 'deckbuilder-add-view-'));
mkdirSync(join(root, 'packages'), { recursive: true });
for (const f of ['apps/gallery/web/src/views.ts', 'apps/gallery/server/views.ts', 'apps/gallery/package.json']) {
  mkdirSync(dirname(join(root, f)), { recursive: true });
  cpSync(join(REPO, f), join(root, f));
}
afterAll(() => rmSync(root, { recursive: true, force: true }));
const read = (f: string) => readFileSync(join(root, f), 'utf8');

test('names from a kebab id', () => {
  expect(viewNames('my-view')).toEqual({ id: 'my-view', name: 'MyView', camel: 'myView', title: 'My View' });
});

test('rejects bad ids', () => {
  for (const id of ['', 'Demo', '1x', 'a_b', 'a--b', '-a', 'a/b']) expect(validateViewId(id, root)).not.toBeNull();
});

test('scaffolds demo and registers it', () => {
  const target = addView({ id: 'demo', root });
  for (const f of ['package.json', 'tsconfig.json', 'README.md', 'src/view.tsx', 'src/server.ts', 'src/i18n.ts', 'src/web.ts', 'src/styles.css']) {
    expect(existsSync(join(target, f))).toBe(true);
  }
  expect(readFileSync(join(target, 'package.json'), 'utf8')).toContain('"@deckbuilderkit/view-demo"');
  const view = readFileSync(join(target, 'src/view.tsx'), 'utf8');
  expect(view).toContain('demoView');
  expect(view).not.toContain('__VIEW_');
  const web = read('apps/gallery/web/src/views.ts');
  expect(web).toContain("import { demoView } from '@deckbuilderkit/view-demo/web';");
  expect(web).toMatch(/demoView\(\{ group: 'nav.section.main', order: \d+ \}\)\],/);
  const server = read('apps/gallery/server/views.ts');
  expect(server).toContain("import { demoServerView } from '@deckbuilderkit/view-demo/server';");
  expect(server.replaceAll('\r\n', '\n')).toContain('  demoServerView(),\n];');
  expect(JSON.parse(read('apps/gallery/package.json')).dependencies['@deckbuilderkit/view-demo']).toBe('workspace:*');
  expect(validateViewId('demo', root)).toContain('already exists');
});
