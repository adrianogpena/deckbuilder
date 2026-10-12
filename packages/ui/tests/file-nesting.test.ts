import { describe, expect, test } from 'bun:test';
import { FileNesting, NESTING_DEFAULTS } from '../src/file-nesting.ts';

const nested = (patterns: Record<string, string>, files: string[], dir = 'src') => {
  const out: Record<string, string[]> = {};
  for (const [parent, children] of new FileNesting(patterns).nest(files, dir)) if (children.size) out[parent] = [...children].sort();
  return out;
};

describe('FileNesting', () => {
  test('default patterns fold lock files under package.json and maps under scripts', () => {
    expect(nested(NESTING_DEFAULTS, ['package.json', 'bun.lock', 'yarn.lock', 'readme.md', 'a.js', 'a.js.map', 'a.d.ts'])).toEqual({
      'package.json': ['bun.lock', 'yarn.lock'],
      'a.js': ['a.d.ts', 'a.js.map'],
    });
  });

  test('${capture} is what the parent star matched', () => {
    expect(nested({ '*.ts': '${capture}.test.ts, ${capture}.spec.ts' }, ['Foo.ts', 'Foo.test.ts', 'Bar.test.ts'])).toEqual({ 'Foo.ts': ['Foo.test.ts'] });
  });

  test('${basename}, ${extname} and ${dirname} come from the parent file', () => {
    expect(nested({ '*.json': '${basename}.${extname}.bak, ${dirname}.lock' }, ['a.json', 'a.json.bak', 'src.lock'])).toEqual({ 'a.json': ['a.json.bak', 'src.lock'] });
  });

  test('a child pattern may have its own star', () => {
    expect(nested({ 'tsconfig.json': 'tsconfig.*.json' }, ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'other.json'])).toEqual({
      'tsconfig.json': ['tsconfig.app.json', 'tsconfig.node.json'],
    });
  });

  test('chains nest under the root ancestor, cycles stay top-level', () => {
    expect(nested({ '*.ts': '${capture}.js', '*.js': '${capture}.js.map' }, ['a.ts', 'a.js', 'a.js.map'])).toEqual({ 'a.ts': ['a.js', 'a.js.map'] });
    const top = new FileNesting({ 'a.txt': 'b.txt', 'b.txt': 'a.txt' }).nest(['a.txt', 'b.txt'], 'x');
    expect(top.size).toBeGreaterThan(0);
  });

  test('a malformed parent pattern is skipped', () => {
    expect(nested({ '*a*': 'x', 'a.txt': 'b.txt' }, ['a.txt', 'b.txt', 'x'])).toEqual({ 'a.txt': ['b.txt'] });
  });
});
