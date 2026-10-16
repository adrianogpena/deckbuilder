import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findViolations } from './check-boundaries';

const root = mkdtempSync(join(tmpdir(), 'boundaries-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function put(path: string, content: string) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

put('apps/gallery/package.json', '{"name":"@deckbuilderkit/gallery"}');
put('apps/gallery/web/main.ts', "import '@deckbuilderkit/view-a';\n");
put('packages/view-a/package.json', '{"name":"@deckbuilderkit/view-a"}');
put('packages/view-a/src/ok.ts', "import { x } from '@deckbuilderkit/ui';\nimport { y } from './other';\nimport '@deckbuilderkit/view-a/src/y';\n");
put('packages/view-a/src/bad-pkg.ts', "import { x } from '@deckbuilderkit/view-b';\n");
put('packages/view-a/src/bad-rel.ts', "export * from '../../view-b/src/x';\n");
put('packages/view-a/src/bad-dyn.ts', "const m = await import('@deckbuilderkit/view-b/src/x');\n");
put('packages/view-a/src/bad-app.ts', "import '../../../apps/gallery/web/main';\n");
put('packages/view-b/package.json', '{"name":"@deckbuilderkit/view-b"}');
put('packages/ui/package.json', '{"name":"@deckbuilderkit/ui"}');
put('packages/ui/src/bad.ts', "import { a } from '@deckbuilderkit/gallery';\n");
put('packages/ui/src/ok.ts', "import { v } from '@deckbuilderkit/view-a';\n");

test('reports view-to-view and package-to-app imports only', () => {
  const found = findViolations(root).map((v) => `${v.file} ${v.specifier}`).sort();
  expect(found).toEqual([
    'packages/ui/src/bad.ts @deckbuilderkit/gallery',
    'packages/view-a/src/bad-app.ts ../../../apps/gallery/web/main',
    'packages/view-a/src/bad-dyn.ts @deckbuilderkit/view-b/src/x',
    'packages/view-a/src/bad-pkg.ts @deckbuilderkit/view-b',
    'packages/view-a/src/bad-rel.ts ../../view-b/src/x',
  ]);
});

test('the real repo has no violations', () => {
  expect(findViolations(join(import.meta.dir, '..'))).toEqual([]);
});
