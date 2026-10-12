import { expect, test } from 'bun:test';
import { applyEol, detectEol, normalizeEol, prepareForSave } from '../src/text-save.ts';

test('detectEol takes the majority and falls back without breaks', () => {
  expect(detectEol('a\r\nb\r\nc\n')).toBe('\r\n');
  expect(detectEol('a\nb\r\nc\n')).toBe('\n');
  expect(detectEol('one line', '\r\n')).toBe('\r\n');
});

test('a CRLF text round-trips through the editor form', () => {
  const disk = 'a\r\nb\r\n';
  expect(applyEol(normalizeEol(disk), detectEol(disk))).toBe(disk);
  expect(normalizeEol('a\rb\r\nc')).toBe('a\nb\nc');
});

test('prepareForSave trims (not markdown) and adds the final newline', () => {
  expect(prepareForSave('a  \nb\t', { trim: true, finalNewline: true, markdown: false })).toBe('a\nb\n');
  expect(prepareForSave('a  \nb', { trim: true, finalNewline: false, markdown: true })).toBe('a  \nb');
  expect(prepareForSave('', { trim: false, finalNewline: true, markdown: false })).toBe('');
});
