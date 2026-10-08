import { expect, test } from 'bun:test';
import { fillPlaceholders, validateNewApp } from './new.ts';

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
