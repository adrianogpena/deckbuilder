import { afterEach, describe, expect, test } from 'bun:test';
import { effectiveName, setFileAssociations, validFileAssociations } from '../src/file-associations';
import { fileIconOf } from '../src/file-icons';

afterEach(() => setFileAssociations([]));

describe('effectiveName', () => {
  test('is the name itself without a matching association', () => {
    setFileAssociations([{ pattern: '*.out', as: 'log' }]);
    expect(effectiveName('a.txt')).toBe('a.txt');
  });

  test('maps a matching name to file.<as>, first match wins, case-insensitive', () => {
    setFileAssociations([{ pattern: 'LOG.*', as: 'log' }, { pattern: '*.1', as: 'txt' }]);
    expect(effectiveName('log.1')).toBe('file.log');
    expect(effectiveName('other.1')).toBe('file.txt');
  });

  test('? matches one character and regex characters are literal', () => {
    setFileAssociations([{ pattern: 'a?.(x)', as: 'json' }]);
    expect(effectiveName('ab.(x)')).toBe('file.json');
    expect(effectiveName('abc.(x)')).toBe('abc.(x)');
    expect(effectiveName('ab.x')).toBe('ab.x');
  });
});

test('fileIconOf follows associations and recognises rotated logs', () => {
  expect(fileIconOf('server.log.3')).toEqual({ icon: 'log-file', tone: 'ok' });
  expect(fileIconOf('trace.out').icon).toBe('file');
  setFileAssociations([{ pattern: '*.out', as: 'log' }]);
  expect(fileIconOf('trace.out').icon).toBe('log-file');
});

describe('validFileAssociations', () => {
  test('cleans and accepts well-formed rows', () => {
    expect(validFileAssociations([{ pattern: ' *.out ', as: '.LOG' }])).toEqual([{ pattern: '*.out', as: 'log' }]);
  });

  test.each([
    [[{ pattern: '', as: 'log' }]],
    [[{ pattern: 'a/b', as: 'log' }]],
    [[{ pattern: '*.x', as: 'not valid' }]],
    [[{ pattern: '*.x' }]],
    ['x'],
  ])('rejects %j', (raw) => {
    expect(validFileAssociations(raw)).toBeNull();
  });
});
