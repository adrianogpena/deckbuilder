import { renderMarkdown } from './markdown';

export interface ExportHtmlOptions {
  /** The page title, e.g. the file name. */
  title?: string;
  /** Maps a relative image src to a URL the page may load (see `imagePolicy`). */
  resolveImage?(src: string): string | null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A standalone HTML page of `markdown`. Needs a DOM (renderMarkdown). Images stay placeholders for now. */
export async function exportHtml(markdown: string, opts: ExportHtmlOptions = {}): Promise<string> {
  const body = renderMarkdown(markdown);
  return `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(opts.title ?? '')}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}
