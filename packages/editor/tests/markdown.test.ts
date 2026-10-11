import { describe, expect, test } from 'bun:test';
import { marked } from 'marked';
import { frontmatter, frontmatterEntries, imagePolicy, linkPolicy } from '../src/markdown.ts';

// bun test has no DOM, so DOMPurify (renderMarkdown) is not run here: only the link and image
// policies its hook applies, and the marked output they act on.
describe('markdown without a DOM', () => {
  test('marked emits GFM tables and language classes on code blocks', () => {
    const html = marked.parse('| a |\n|---|\n| 1 |\n\n```sql\nselect 1\n```', { gfm: true, async: false }) as string;
    expect(html).toContain('<table>');
    expect(html).toContain('<code class="language-sql">');
  });

  test('linkPolicy keeps http(s) and anchors, drops other schemes', () => {
    expect(linkPolicy('https://example.com')).toEqual({ href: 'https://example.com', external: true });
    expect(linkPolicy('mailto:a@b.c')).toBeNull();
    expect(linkPolicy('#usage')).toEqual({ href: '#usage', external: false });
    expect(linkPolicy('javascript:alert(1)')).toBeNull();
    expect(linkPolicy(' JavaScript:alert(1)')).toBeNull();
    expect(linkPolicy('file:///C:/x')).toBeNull();
    expect(linkPolicy('data:text/html,x')).toBeNull();
    expect(linkPolicy('other.md')).toBeNull();
  });

  test('imagePolicy resolves relative images and blocks the rest', () => {
    const resolve = (src: string) => `blob:${src}`;
    expect(imagePolicy('img/a.png', resolve)).toBe('blob:img/a.png');
    expect(imagePolicy('img/a.png')).toBe('blocked');
    expect(imagePolicy('img/a.png', () => null)).toBe('blocked');
    expect(imagePolicy('https://x.io/a.png', resolve)).toBe('blocked');
    expect(imagePolicy('//x.io/a.png', resolve)).toBe('blocked');
    expect(imagePolicy('file:///C:/a.png', resolve)).toBe('blocked');
    expect(imagePolicy('data:image/png;base64,AAAA', resolve)).toBe('data:image/png;base64,AAAA');
    expect(imagePolicy('data:image/svg+xml;base64,AAAA', resolve)).toBe('blocked');
  });
});

describe('frontmatter', () => {
  test('is split from the body', () => {
    const md = '---\ntitle: A\ntags: [x]\n---\n# Hi\n';
    expect(frontmatter(md)).toEqual({ length: md.indexOf('# Hi'), yaml: 'title: A\ntags: [x]' });
  });
  test('needs the opening marker on the first line', () => {
    expect(frontmatter('# Hi\n---\na: 1\n---\n')).toBeNull();
    expect(frontmatter('---\na: 1\n')).toBeNull();
  });
  test('may be empty', () => {
    expect(frontmatter('---\n---\nx')).toEqual({ length: 8, yaml: '' });
  });
});

describe('frontmatterEntries', () => {
  test('lists top-level keys and folds lists and quotes', () => {
    const yaml = 'title: "A: b"\ntags:\n  - x\n  - y\nflow: [a, b]\n# c\ndraft: true';
    expect(frontmatterEntries(yaml)).toEqual([
      ['title', 'A: b'],
      ['tags', 'x, y'],
      ['flow', '[a, b]'],
      ['draft', 'true'],
    ]);
  });
  test('is null without keys', () => {
    expect(frontmatterEntries('just text')).toBeNull();
  });
});
