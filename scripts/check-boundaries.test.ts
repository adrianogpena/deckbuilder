import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findNativeDialogs, findViolations } from './check-boundaries';

const root = mkdtempSync(join(tmpdir(), 'boundaries-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function put(path: string, content: string) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

put('app/package.json', '{"name":"@kedalion/app"}');
put('app/web/main.ts', "import '@kedalion/view-a';\n");
put('packages/view-a/package.json', '{"name":"@kedalion/view-a"}');
put('packages/view-a/src/ok.ts', "import { x } from '@kedalion/ui';\nimport { y } from './other';\nimport '@kedalion/view-a/src/y';\n");
put('packages/view-a/src/bad-pkg.ts', "import { x } from '@kedalion/view-b';\n");
put('packages/view-a/src/bad-rel.ts', "export * from '../../view-b/src/x';\n");
put('packages/view-a/src/bad-dyn.ts', "const m = await import('@kedalion/view-b/src/x');\n");
put('packages/view-a/src/bad-app.ts', "import '../../../app/web/main';\n");
put('packages/view-b/package.json', '{"name":"@kedalion/view-b"}');
put('packages/ui/package.json', '{"name":"@kedalion/ui"}');
put('packages/ui/src/bad.ts', "import { a } from '@kedalion/app';\n");
put('packages/ui/src/ok.ts', "import { v } from '@kedalion/view-a';\n");

test('reports view-to-view and package-to-app imports only', () => {
  const found = findViolations(root).map((v) => `${v.file} ${v.specifier}`).sort();
  expect(found).toEqual([
    'packages/ui/src/bad.ts @kedalion/app',
    'packages/view-a/src/bad-app.ts ../../../app/web/main',
    'packages/view-a/src/bad-dyn.ts @kedalion/view-b/src/x',
    'packages/view-a/src/bad-pkg.ts @kedalion/view-b',
    'packages/view-a/src/bad-rel.ts ../../view-b/src/x',
  ]);
});

test('the real repo has no violations', () => {
  expect(findViolations(join(import.meta.dir, '..'))).toEqual([]);
  expect(findNativeDialogs(join(import.meta.dir, '..'))).toEqual([]);
});

test('reports native dialog markers, not the UI hooks', () => {
  const dialogRoot = mkdtempSync(join(tmpdir(), 'boundaries-native-'));
  const write = (path: string, content: string) => {
    const full = join(dialogRoot, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  write('packages/p/src/win.ts', "user32.symbols.MessageBoxW(null, a, b, 0);\nconst f = 'FOS_PICKFOLDERS';\n");
  write('packages/p/src/linux.ts', "Bun.spawn(['zenity', '--file-selection']);\n");
  write('packages/p/src/mac.ts', "run(['osascript', '-e', 'display dialog \"x\"']);\n");
  write('packages/p/src/mac-choose.ts', "const s = 'choose folder';\n");
  write('packages/p/src/trash.ts', "run(['osascript', '-e', 'tell application \"Finder\" to delete x']);\n");
  write('packages/p/src/win.test.ts', "MessageBoxW zenity\n");
  write('packages/p/node_modules/x/index.ts', "MessageBoxW\n");
  write('packages/ui/src/web.tsx', "window.alert('x');\nif (confirm('sure?')) {}\nawait confirm({ title: 'x' });\nstores.ui.prompt('x');\n");
  write('packages/view-a/src/Screen.tsx', "window.prompt(t('x'));\n");
  write('packages/view-a/src/server.ts', "const confirm = (s: string) => s;\nconfirm('x');\n");
  write('app/web/src/a.ts', "alert(t('x'));\n");
  const found = findNativeDialogs(dialogRoot).map((v) => `${v.file} ${v.specifier}`).sort();
  expect(found).toEqual([
    'app/web/src/a.ts:1 alert(t(',
    'packages/p/src/linux.ts:1 zenity',
    'packages/p/src/mac-choose.ts:1 choose folder',
    'packages/p/src/mac.ts:1 osascript\', \'-e\', \'display dialog',
    'packages/p/src/win.ts:1 MessageBoxW',
    'packages/p/src/win.ts:2 FOS_PICKFOLDERS',
    'packages/ui/src/web.tsx:1 window.alert(',
    'packages/ui/src/web.tsx:2 confirm(\'',
    'packages/view-a/src/Screen.tsx:1 window.prompt(',
  ]);
  expect(findNativeDialogs(dialogRoot).every((v) => v.rule.startsWith('native dialog: use the dialogs from @kedalion/ui'))).toBe(true);
  rmSync(dialogRoot, { recursive: true, force: true });
});
