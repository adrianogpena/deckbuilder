import { MARKDOWN_SETTINGS_DEFAULTS, type MarkdownSettings } from '@deckbuilderkit/editor/markdown-commands';
import { useMemo } from 'react';

/** The effective markdown settings; for now the defaults, with the table of contents from `files.markdownToc`. */
export function useMarkdownSettings(markdownToc = true): MarkdownSettings {
  return useMemo(() => ({ ...MARKDOWN_SETTINGS_DEFAULTS, toc: markdownToc }), [markdownToc]);
}

/** Shows the effective markdown settings in a dialog. */
export function inspectMarkdownConfig(): void {}
