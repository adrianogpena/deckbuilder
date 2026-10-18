import { describe, expect, test } from 'bun:test';
import { marked } from 'marked';
import { exportHtml, MAX_EMBED_BYTES, type ExportImage } from '../src/exportHtml.ts';

const render = (md: string) => marked.parse(md, { gfm: true, async: false }) as string;
const png = (size: number): ExportImage => ({ mime: 'image/png', bytes: new Uint8Array(size).fill(65) });

describe('exportHtml', () => {
  test('embeds a local image up to 2 MiB as a data URI', async () => {
    const html = await exportHtml('![logo](img/a.png)', { render, loadImage: async () => png(4) });
    expect(html).toContain('<img src="data:image/png;base64,QUFBQQ==" alt="logo">');
  });

  test('a local image over 2 MiB becomes its alt text', async () => {
    const html = await exportHtml('![big pic](big.png)', { render, loadImage: async () => png(MAX_EMBED_BYTES + 1) });
    expect(html).not.toContain('<img');
    expect(html).toContain('big pic');
  });

  test('remote and data images become alt text and are never loaded', async () => {
    const loaded: string[] = [];
    const html = await exportHtml('![r](https://x.test/a.png) ![d](data:image/png;base64,AAAA)', {
      render,
      loadImage: async (s) => (loaded.push(s), png(4)),
    });
    expect(loaded).toEqual([]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('x.test');
  });

  test('an unreadable image becomes alt text', async () => {
    const html = await exportHtml('![gone](gone.png)', { render, loadImage: async () => null });
    expect(html).not.toContain('<img');
    expect(html).toContain('gone');
  });

  test('mermaid stays a code block', async () => {
    const html = await exportHtml('```mermaid\ngraph TD\n A-->B\n```', { render });
    expect(html).toContain('<code class="language-mermaid">');
  });

  test('no script or event handler in the output', async () => {
    const html = await exportHtml('x', {
      render: () => '<p onclick="a()">hi</p><script>alert(1)</script><img src="a.png" alt="" onerror=\'b()\'>',
      loadImage: async () => png(2),
    });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).toContain('<p>hi</p>');
  });

  test('frontmatter table from the renderer is kept; page has charset, title and print rules', async () => {
    const html = await exportHtml('x', {
      title: 'a <b>.md',
      render: () => '<table class="md-frontmatter"><tbody><tr><th scope="row">title</th><td>A</td></tr></tbody></table>',
    });
    expect(html).toContain('class="md-frontmatter"');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>a &lt;b&gt;.md</title>');
    expect(html).toContain('@media print');
  });
});
