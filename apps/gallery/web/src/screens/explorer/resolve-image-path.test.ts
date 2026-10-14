import { describe, expect, test } from 'bun:test';
import { resolveImagePath } from './resolve-image-path';

describe('resolveImagePath', () => {
  test('relative to the file directory', () => {
    expect(resolveImagePath('docs/a.md', 'img/a.png')).toBe('docs/img/a.png');
    expect(resolveImagePath('a.md', './a.png')).toBe('a.png');
  });
  test('parent segments', () => {
    expect(resolveImagePath('docs/x/a.md', '../assets/e.svg')).toBe('docs/assets/e.svg');
  });
  test('leading slash is the project root', () => {
    expect(resolveImagePath('docs/a.md', '/img/a.png')).toBe('img/a.png');
  });
  test('escaping the root is null', () => {
    expect(resolveImagePath('docs/a.md', '../../a.png')).toBeNull();
    expect(resolveImagePath('a.md', '../a.png')).toBeNull();
  });
  test('strips query and hash, decodes escapes', () => {
    expect(resolveImagePath('a.md', 'my%20img.png?x=1#h')).toBe('my img.png');
  });
});
