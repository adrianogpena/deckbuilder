import { describe, expect, test } from 'bun:test';
import { Schema } from '@milkdown/prose/model';
import { EditorState, TextSelection } from '@milkdown/prose/state';
import { classifyLink, linkHrefAtCursor, relativeLinkPath, resolveLinkPath } from '../src/rich/navLinks';
import { filterHeadings, findAnchor, headingSlugs, scanHeadings, slugify } from '../src/toc';

describe('relativeLinkPath', () => {
  test('same folder', () => {
    expect(relativeLinkPath('docs/a.md', 'docs/b.md')).toBe('b.md');
  });
  test('parent and sibling folders', () => {
    expect(relativeLinkPath('docs/guide/a.md', 'README.md')).toBe('../../README.md');
    expect(relativeLinkPath('docs/guide/a.md', 'docs/api/b.md')).toBe('../api/b.md');
    expect(relativeLinkPath('a.md', 'src/b.md')).toBe('src/b.md');
  });
  test('percent-encodes spaces and link breakers', () => {
    expect(relativeLinkPath('a.md', 'my docs/read me (1).md')).toBe('my%20docs/read%20me%20%281%29.md');
  });
  test('Windows drive paths', () => {
    expect(relativeLinkPath('C:\\proj\\docs\\a.md', 'C:\\proj\\src\\b.md')).toBe('../src/b.md');
    expect(relativeLinkPath('c:/proj/a.md', 'C:/proj/b.md')).toBe('b.md');
    expect(relativeLinkPath('C:/proj/a.md', 'D:/other/b.md')).toBe('D:/other/b.md');
  });
  test('an untitled text links from the root', () => {
    expect(relativeLinkPath('', 'docs/b.md')).toBe('docs/b.md');
  });
});

describe('resolveLinkPath', () => {
  test('resolves against the open file', () => {
    expect(resolveLinkPath('docs/a.md', 'b.md')).toBe('docs/b.md');
    expect(resolveLinkPath('docs/guide/a.md', '../../README.md')).toBe('README.md');
    expect(resolveLinkPath('docs/a.md', './x/../y.md#top')).toBe('docs/y.md');
  });
  test('decodes percent escapes', () => {
    expect(resolveLinkPath('a.md', 'my%20docs/b.md')).toBe('my docs/b.md');
  });
  test('a leading slash starts at the project root', () => {
    expect(resolveLinkPath('docs/a.md', '/README.md')).toBe('README.md');
  });
  test('rejects paths above the root, schemes and empty paths', () => {
    expect(resolveLinkPath('a.md', '../x.md')).toBeNull();
    expect(resolveLinkPath('a.md', 'mailto:x@y.z')).toBeNull();
    expect(resolveLinkPath('a.md', '#top')).toBeNull();
  });
});

describe('classifyLink', () => {
  test('anchor, external and file', () => {
    expect(classifyLink('#intro', 'a.md')).toEqual({ kind: 'anchor', fragment: '#intro' });
    expect(classifyLink('https://x.dev/a', 'a.md')).toEqual({ kind: 'external', href: 'https://x.dev/a' });
    expect(classifyLink('../README.md', 'docs/a.md')).toEqual({ kind: 'file', path: 'README.md' });
  });
  test('a link to this very file with an anchor scrolls', () => {
    expect(classifyLink('a.md#two', 'a.md')).toEqual({ kind: 'anchor', fragment: '#two' });
  });
  test('other schemes are not followed', () => {
    expect(classifyLink('mailto:x@y.z', 'a.md')).toBeNull();
    expect(classifyLink('javascript:alert(1)', 'a.md')).toBeNull();
  });
});

describe('slugs', () => {
  test('lower case with dashes, punctuation dropped', () => {
    expect(slugify('Getting Started!')).toBe('getting-started');
  });
  test('Unicode letters are kept', () => {
    expect(slugify('Configuração Rápida')).toBe('configuração-rápida');
    expect(slugify('日本語 の 見出し')).toBe('日本語-の-見出し');
  });
  test('repeated headings get a numeric suffix', () => {
    expect(headingSlugs(['Intro', 'Usage', 'Intro', 'Intro'])).toEqual(['intro', 'usage', 'intro-1', 'intro-2']);
  });
  test('findAnchor decodes the fragment', () => {
    const list = [{ slug: 'configuração' }, { slug: 'intro' }];
    expect(findAnchor(list, '#configura%C3%A7%C3%A3o')).toBe(list[0]);
    expect(findAnchor(list, '#Intro')).toBe(list[1]);
    expect(findAnchor(list, '#missing')).toBeUndefined();
  });
});

describe('heading list', () => {
  const node = (name: string, text = '', level?: number) => ({ type: { name }, attrs: level ? { level } : {}, textContent: text });
  const doc = {
    descendants(visit: (n: ReturnType<typeof node>, pos: number) => boolean | void) {
      const items: [ReturnType<typeof node>, number][] = [
        [node('paragraph', 'hi'), 0], [node('heading', 'Ação rápida', 2), 5], [node('blockquote'), 30], [node('heading', ' Intro ', 1), 32],
      ];
      for (const [n, pos] of items) visit(n, pos);
    },
  };

  test('scanHeadings reads level, text, position and slug', () => {
    expect(scanHeadings(doc)).toEqual([
      { level: 2, text: 'Ação rápida', pos: 5, slug: 'ação-rápida' },
      { level: 1, text: 'Intro', pos: 32, slug: 'intro' },
    ]);
  });
  test('filterHeadings ignores accents and case', () => {
    const headings = scanHeadings(doc);
    expect(filterHeadings(headings, 'ACAO').map((h) => h.text)).toEqual(['Ação rápida']);
    expect(filterHeadings(headings, 'rápida').map((h) => h.text)).toEqual(['Ação rápida']);
    expect(filterHeadings(headings, '')).toHaveLength(2);
    expect(filterHeadings(headings, 'zzz')).toHaveLength(0);
  });
});

describe('linkHrefAtCursor', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'text*', toDOM: () => ['p', 0] },
      text: {},
    },
    marks: { link: { attrs: { href: {} }, inclusive: false, toDOM: (m) => ['a', { href: m.attrs.href }, 0] } },
  });
  const link = schema.marks.link!.create({ href: 'b.md' });
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('see '), schema.text('the docs', [link]), schema.text(' now')])]);
  const at = (pos: number, to = pos) => EditorState.create({ doc, selection: TextSelection.create(doc, pos, to) });

  test('inside the link', () => {
    expect(linkHrefAtCursor(at(8))).toBe('b.md');
  });
  test('not at the edges, outside or with a selection', () => {
    expect(linkHrefAtCursor(at(5))).toBeNull();
    expect(linkHrefAtCursor(at(13))).toBeNull();
    expect(linkHrefAtCursor(at(2))).toBeNull();
    expect(linkHrefAtCursor(at(7, 9))).toBeNull();
  });
});
