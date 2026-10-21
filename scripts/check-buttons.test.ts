import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { findRawButtons } from './check-buttons';

test('the real repo has no raw button beyond the list', () => {
  expect(findRawButtons(join(import.meta.dir, '..'))).toEqual([]);
});

test('reports raw buttons above the allowed count, not Button or tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'buttons-'));
  const put = (path: string, content: string) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  put('packages/ui/src/components/Button.tsx', '<button className="btn" />');
  put('packages/p/src/ok.tsx', '<Button>x</Button><IconButton label="y" />');
  put('packages/p/src/bad.tsx', '<button className="my-btn">x</button>');
  put('packages/p/src/listed.tsx', '<button className="tab" />\n<button className="tab" />');
  put('packages/p/src/dom.ts', "const b = document.createElement('button');");
  put('packages/p/src/bad.test.tsx', '<button />');
  put('packages/p/node_modules/x/index.tsx', '<button />');
  const found = findRawButtons(root, { 'packages/p/src/listed.tsx': 2 }).map((v) => `${v.file} ${v.specifier}`).sort();
  expect(found).toEqual(['packages/p/src/bad.tsx 1 raw button(s), 0 allowed', 'packages/p/src/dom.ts 1 raw button(s), 0 allowed']);
  rmSync(root, { recursive: true, force: true });
});
