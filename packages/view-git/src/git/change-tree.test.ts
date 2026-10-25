import { expect, test } from 'bun:test';
import type { GitFile } from '@kedalion/server-core/protocol';
import { changeTree, folderPaths } from './change-tree';

const file = (path: string): GitFile => ({ path, group: 'unstaged', index: '.', worktree: 'M' }) as GitFile;

test('nests files under folders, folders first, and compacts single-child chains', () => {
  const tree = changeTree([file('z.txt'), file('src/main/java/App.java'), file('src/main/java/b/B.java'), file('a/x.ts'), file('a/y.ts')]);
  expect(tree.files.map((f) => f.path)).toEqual(['z.txt']);
  expect(tree.folders.map((f) => [f.name, f.path])).toEqual([['a', 'a'], ['src/main/java', 'src/main/java']]);
  const java = tree.folders[1]!;
  expect(java.files.map((f) => f.path)).toEqual(['src/main/java/App.java']);
  expect(java.folders.map((f) => f.path)).toEqual(['src/main/java/b']);
  expect(folderPaths(tree)).toEqual(['a', 'src/main/java', 'src/main/java/b']);
});
