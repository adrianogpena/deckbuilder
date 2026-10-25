import { buttonClass, copyText, t } from '@kedalion/ui';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { type MouseEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { langOfFile, type Parser, parserOf } from './languages';
import { renderMarkdown } from './markdown';
import { MarkdownToc, type TocHeading } from './MarkdownToc';

/** Replaces a code element's text with `tok-*` spans (classHighlighter); styled by `.markdown .tok-*`. */
function highlightCode(code: HTMLElement, parser: Parser) {
  const text = code.textContent ?? '';
  const out = document.createDocumentFragment();
  let pos = 0;
  highlightTree(parser.parse(text), classHighlighter, (from, to, classes) => {
    if (from > pos) out.append(text.slice(pos, from));
    const span = document.createElement('span');
    span.className = classes;
    span.textContent = text.slice(from, to);
    out.append(span);
    pos = to;
  });
  if (pos < text.length) out.append(text.slice(pos));
  code.replaceChildren(out);
}

/**
 * Rendered, sanitized markdown; code blocks highlighted when their fence names a file extension with a parser.
 * `toc` adds a heading rail (MarkdownToc) that tracks the nearest scrolling ancestor.
 */
export function MarkdownView({ markdown, resolveImage, toc }: { markdown: string; resolveImage?(src: string): string | null; toc?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const html = useMemo(
    () => renderMarkdown(markdown, { resolveImage, blockedLabel: t('preview.remoteImageBlocked') }),
    [markdown, resolveImage],
  );

  useLayoutEffect(() => {
    for (const code of host.current?.querySelectorAll<HTMLElement>('pre > code[class*="language-"]') ?? []) {
      const fence = /language-(\w+)/.exec(code.className)?.[1];
      const parser = fence ? parserOf(fence.toLowerCase() === 'shell' ? 'shell' : langOfFile('x.' + fence)) : null;
      if (parser) highlightCode(code, parser);
    }
    for (const pre of host.current?.querySelectorAll<HTMLElement>('pre') ?? []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = buttonClass('ghost', 'xs', false, 'md-code-copy');
      button.textContent = t('output.copyAll');
      const wrap = document.createElement('div');
      wrap.className = 'md-code';
      pre.replaceWith(wrap);
      wrap.append(pre, button);
    }
  }, [html]);

  useLayoutEffect(() => {
    if (!toc) return;
    setHeadings([...(host.current?.querySelectorAll<HTMLElement>('h1, h2, h3') ?? [])]
      .map((el) => ({ el, level: Number(el.tagName[1]), text: el.textContent?.trim() ?? '' })));
  }, [html, toc]);

  const onClick = async (e: MouseEvent<HTMLDivElement>) => {
    const button = e.target as HTMLElement;
    if (button.closest('a[href^="#"]')) {
      e.preventDefault();
      return;
    }
    if (!button.classList.contains('md-code-copy')) return;
    const code = button.parentElement?.querySelector('code') ?? button.parentElement;
    if (!code || !(await copyText(code.textContent ?? ''))) return;
    button.textContent = t('common.copied');
    setTimeout(() => {
      button.textContent = t('output.copyAll');
    }, 1500);
  };

  const view = <div ref={host} className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
  if (!toc) return view;
  return (
    <div className={'md-toc-wrap' + (headings.length >= 2 ? ' has-toc' : '')}>
      <MarkdownToc headings={headings} content={host} />
      {view}
    </div>
  );
}
