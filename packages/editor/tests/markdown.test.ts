import { describe, expect, test } from 'bun:test';
import { marked } from 'marked';
import { imagePolicy, linkPolicy } from '../src/markdown.ts';

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
