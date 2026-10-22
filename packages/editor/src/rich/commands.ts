import type { Ctx, MilkdownPlugin } from '@milkdown/ctx';
import type { EditorView } from '@milkdown/prose/view';
import type { ComponentType } from 'react';

/** Every markdown editor command; the host registers `explorer.markdown.<id>` for each. */
export const RICH_COMMAND_IDS = [
  'toggleSource',
  'bold', 'italic', 'strike',
  'paragraph', 'h1', 'h2', 'h3',
  'bulletList', 'numberedList', 'toggleTask',
  'insertLink', 'insertCodeBlock',
  'insertTable', 'tableActions', 'addTableRow', 'addTableColumn',
  'insertMermaid',
  'goToHeading', 'insertFileLink',
  'exportHtml',
  'zoomIn', 'zoomOut', 'zoomReset', 'zoomFit',
  'inspectConfig',
] as const;

export type RichCommandId = (typeof RICH_COMMAND_IDS)[number];

/** The editor modes: the Milkdown pane, or the raw text in CodeMirror. */
export type MarkdownMode = 'rich' | 'source';

export const MARKDOWN_MODES: readonly MarkdownMode[] = ['rich', 'source'];

/** Text column width: a comfortable measure, the full pane, a number of characters (40-120) or a percentage string like `"70%"` (50-100) of the pane, never narrower than comfortable. */
export type ReadingWidth = 'comfortable' | 'full' | number | `${number}%`;

/** The effective markdown settings the host passes to the pane. */
export interface MarkdownSettings {
  defaultMode: MarkdownMode;
  readingWidth: ReadingWidth;
  /** Editor zoom in percent, 50-200. */
  zoom: number;
  /** Render ```mermaid blocks as diagrams. */
  mermaid: boolean;
  /** Show the heading rail. */
  toc: boolean;
  /** Link button at the left of a hovered heading. */
  headingLinks: boolean;
  /** Source line numbers in a gutter. */
  lineNumbers: boolean;
  /** A single newline in the text shows as a line break. */
  lineBreaks: boolean;
}

export const MARKDOWN_SETTINGS_DEFAULTS: MarkdownSettings = {
  defaultMode: 'rich', readingWidth: 'comfortable', zoom: 100, mermaid: true, toc: true, headingLinks: true, lineNumbers: false, lineBreaks: true,
};

/** What the pane asks of the app hosting it. */
export interface RichHost {
  /** The open file, relative to the project root with `/` separators ('' for an untitled text). */
  filePath: string;
  /** Opens another file of the project (a path like `filePath`). */
  onOpenPath(path: string): void;
  /** The native "Open file" dialog; a project-relative path like `filePath`, null when cancelled or outside the project. */
  pickFile(): Promise<string | null>;
  /** The native "Save as" dialog, then writes `content` there; false when cancelled. */
  saveAs(defaultName: string, content: string): Promise<boolean>;
  /** Maps a relative image src to a URL the page may load; null blocks it (see `imagePolicy`). */
  resolveImage?(src: string): string | null;
  settings: MarkdownSettings;
}

/** What a feature handler or overlay works with. */
export interface RichApi {
  view: EditorView;
  ctx: Ctx;
  host: RichHost;
  /** The whole text: the original bytes while unedited, else the frontmatter plus the serialized document. */
  getMarkdown(): string;
}

/** A command handler: true when it handled the command. */
export type RichHandler = (api: RichApi) => boolean;

/** One feature of the rich pane: Milkdown plugins, command handlers and a React overlay. */
export interface RichFeature {
  plugins?: MilkdownPlugin[];
  handlers?: Partial<Record<RichCommandId, RichHandler>>;
  /** Rendered above the document while the pane is ready; a toolbar sits in the flow, popups position themselves. */
  Overlay?: ComponentType<{ api: RichApi }>;
}

/** Runs `id` through the first feature whose handler takes it. */
export function runRichCommand(features: readonly RichFeature[], id: RichCommandId, api: RichApi): boolean {
  for (const f of features) {
    const handler = f.handlers?.[id];
    if (handler?.(api)) return true;
  }
  return false;
}
