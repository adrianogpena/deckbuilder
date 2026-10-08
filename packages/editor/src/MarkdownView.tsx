import { jsonLanguage } from '@codemirror/lang-json';
import { StandardSQL } from '@codemirror/lang-sql';
import { type Language, StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { t } from '@deckbuilder/ui';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { renderMarkdown } from './markdown';

type Parser = Language['parser'];

const shellParser = StreamLanguage.define(shell).parser;
const PARSERS: Record<string, Parser> = {
  sql: StandardSQL.language.parser,
  json: jsonLanguage.parser,
  sh: shellParser,
  bash: shellParser,
  shell: shellParser,
};

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

/** Rendered, sanitized markdown; sql/json/shell code blocks highlighted. */
export function MarkdownView({ markdown, resolveImage }: { markdown: string; resolveImage?(src: string): string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () => renderMarkdown(markdown, { resolveImage, blockedLabel: t('preview.remoteImageBlocked') }),
    [markdown, resolveImage],
  );

  useLayoutEffect(() => {
    for (const code of host.current?.querySelectorAll<HTMLElement>('pre > code[class*="language-"]') ?? []) {
      const lang = /language-(\w+)/.exec(code.className)?.[1]?.toLowerCase();
      const parser = lang ? PARSERS[lang] : undefined;
      if (parser) highlightCode(code, parser);
    }
  }, [html]);

  return <div ref={host} className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
