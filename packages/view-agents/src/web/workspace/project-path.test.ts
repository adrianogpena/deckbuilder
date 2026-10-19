import { expect, test } from 'bun:test';
import { projectPathOf, sameFolder } from './project-path';

test('folders match across slash style, trailing slash and case', () => {
  expect(sameFolder('C:\\Work\\App\\', 'c:/work/app')).toBe(true);
  expect(sameFolder('C:/work/app', 'C:/work/other')).toBe(false);
  expect(projectPathOf({ project: 'p', cwd: 'C:/work/app/sub' }, [{ id: 'p', path: 'C:/work/app' }])).toBe('C:/work/app');
  expect(projectPathOf({ cwd: 'C:/loose' }, [])).toBe('C:/loose');
});
