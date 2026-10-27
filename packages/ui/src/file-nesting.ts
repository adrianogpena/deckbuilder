/**
 * File nesting like VS Code's Explorer (`explorer.fileNesting.*`): related files in a folder show under one parent file.
 * A pattern pairs a parent glob with child patterns; a parent glob has at most one `*`, and a child pattern may use
 * `${capture}` (what the parent's `*` matched), `${basename}`, `${extname}`, `${dirname}` and a `*` of its own.
 */

export type NestingPatterns = Record<string, string>;

export const NESTING_DEFAULTS: NestingPatterns = {
  '*.ts': '${capture}.js',
  '*.js': '${capture}.js.map, ${capture}.min.js, ${capture}.d.ts',
  '*.jsx': '${capture}.js',
  '*.tsx': '${capture}.ts',
  'tsconfig.json': 'tsconfig.*.json',
  'package.json': 'package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb, bun.lock',
};

interface Attributes {
  basename: string;
  extname: string;
  dirname: string;
}

type Part = { sub: 'basename' | 'dirname' | 'extname' | 'capture' } | { text: string };

const TOKEN = /\$[({](capture|basename|dirname|extname)[)}]/g;

class Substitution {
  private parts: Part[] = [];

  constructor(pattern: string) {
    let last = 0;
    for (const m of pattern.matchAll(TOKEN)) {
      this.parts.push({ text: pattern.slice(last, m.index) }, { sub: m[1] as 'capture' });
      last = m.index + m[0].length;
    }
    this.parts.push({ text: pattern.slice(last) });
  }

  apply(attrs: Attributes, capture = ''): string {
    return this.parts.map((p) => ('text' in p ? p.text : p.sub === 'capture' ? capture : attrs[p.sub])).join('');
  }
}

/** Suffix trie over the part of a key after its first `*`, read from the end of the file name. */
class SufTrie {
  private star: Substitution[] = [];
  private epsilon: Substitution[] = [];
  private map = new Map<string, SufTrie>();

  add(key: string, value: string) {
    if (key === '*') this.star.push(new Substitution(value));
    else if (key === '') this.epsilon.push(new Substitution(value));
    else {
      const tail = key[key.length - 1];
      if (tail === '*') throw new Error(`Unexpected star in key: ${key}`);
      let next = this.map.get(tail);
      if (!next) this.map.set(tail, (next = new SufTrie()));
      next.add(key.slice(0, -1), value);
    }
  }

  get(key: string, attrs: Attributes): string[] {
    const out: string[] = [];
    if (key === '') out.push(...this.epsilon.map((s) => s.apply(attrs)));
    out.push(...this.star.map((s) => s.apply(attrs, key)));
    const next = this.map.get(key[key.length - 1]);
    if (next) out.push(...next.get(key.slice(0, -1), attrs));
    return out;
  }
}

/** Prefix trie over the part of a key before its `*`. */
class PreTrie {
  private value = new SufTrie();
  private map = new Map<string, PreTrie>();

  add(key: string, value: string) {
    if (key === '' || key[0] === '*') this.value.add(key, value);
    else {
      let next = this.map.get(key[0]);
      if (!next) this.map.set(key[0], (next = new PreTrie()));
      next.add(key.slice(1), value);
    }
  }

  get(key: string, attrs: Attributes): string[] {
    const out = this.value.get(key, attrs);
    const next = this.map.get(key[0]);
    if (next) out.push(...next.get(key.slice(1), attrs));
    return out;
  }
}

function attributesOf(filename: string, dirname: string): Attributes {
  const dot = filename.lastIndexOf('.');
  return dot < 1 ? { dirname, basename: filename, extname: '' } : { dirname, basename: filename.slice(0, dot), extname: filename.slice(dot + 1) };
}

export class FileNesting {
  private root = new PreTrie();

  /** `patterns` values are comma separated child patterns; a malformed parent pattern (two stars) is skipped. */
  constructor(patterns: NestingPatterns) {
    for (const [parent, children] of Object.entries(patterns)) {
      for (const child of children.split(',').map((c) => c.trim()).filter(Boolean)) {
        try {
          this.root.add(parent, child);
        } catch {
          break;
        }
      }
    }
  }

  /** Each top-level file mapped to the files nested under it; nested files are keys of no entry. `dirname` is the folder's name. */
  nest(files: string[], dirname: string): Map<string, Set<string>> {
    const parents = new PreTrie();
    for (const file of files) {
      for (const child of this.root.get(file, attributesOf(file, dirname))) {
        try {
          parents.add(child, file);
        } catch {
          // a child pattern with two stars cannot be indexed; skip it
        }
      }
    }

    const rootsOf = (file: string, seen = new Set<string>()): string[] => {
      if (seen.has(file)) return [];
      seen.add(file);
      const ancestors = parents.get(file, attributesOf(file, dirname));
      if (ancestors.length === 0 || (ancestors.length === 1 && ancestors[0] === file)) return [file];
      return ancestors.flatMap((a) => rootsOf(a, seen));
    };

    const result = new Map<string, Set<string>>();
    for (const file of files) {
      const roots = rootsOf(file);
      for (const root of roots.length ? roots : [file]) {
        let set = result.get(root);
        if (!set) result.set(root, (set = new Set()));
        if (file !== root) set.add(file);
      }
    }
    return result;
  }
}
