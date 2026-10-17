import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotesStore } from './notes.ts';

test('write persists per project and read returns it', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'agents-notes-')), 'agents', 'notes');
  const s = createNotesStore(dir);
  expect(s.read('p1')).toBe('');
  expect(s.write('p1', '# hi')).toBe(true);
  expect(s.write('p2', 'other')).toBe(true);
  expect(createNotesStore(dir).read('p1')).toBe('# hi');
  expect(s.read('p2')).toBe('other');
});

test('ids that could escape the directory are refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'agents-notes-'));
  const s = createNotesStore(join(root, 'notes'));
  for (const id of ['../x', 'a/b', 'a\b', '..', '.', '']) {
    expect(s.write(id, 'x')).toBe(false);
    expect(s.read(id)).toBe('');
  }
  expect(existsSync(join(root, 'x.md'))).toBe(false);
});
