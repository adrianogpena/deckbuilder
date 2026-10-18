import { MARKDOWN_MODES, MARKDOWN_SETTINGS_DEFAULTS, type MarkdownSettings } from '@deckbuilderkit/editor/markdown-commands';

/** The stored `markdown` settings; the table of contents stays in `files.markdownToc`. */
export type MarkdownStored = Omit<MarkdownSettings, 'toc'>;

export const READING_WIDTH_MIN = 40;
export const READING_WIDTH_MAX = 120;
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;

export const MARKDOWN_STORED_DEFAULTS: MarkdownStored = {
  defaultMode: MARKDOWN_SETTINGS_DEFAULTS.defaultMode,
  readingWidth: MARKDOWN_SETTINGS_DEFAULTS.readingWidth,
  zoom: MARKDOWN_SETTINGS_DEFAULTS.zoom,
  mermaid: MARKDOWN_SETTINGS_DEFAULTS.mermaid,
};

const validWidth = (v: unknown): v is MarkdownStored['readingWidth'] =>
  v === 'comfortable' || v === 'full' || (typeof v === 'number' && Number.isInteger(v) && v >= READING_WIDTH_MIN && v <= READING_WIDTH_MAX);

const validZoom = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= ZOOM_MIN && v <= ZOOM_MAX && v % ZOOM_STEP === 0;

const KEYS = new Set(Object.keys(MARKDOWN_STORED_DEFAULTS));

/** A copy of `raw` when every field is known and in range, else null. */
export function validMarkdown(raw: unknown): Partial<MarkdownStored> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !KEYS.has(k))) return null;
  const out: Partial<MarkdownStored> = {};
  if (r.defaultMode !== undefined) {
    if (!MARKDOWN_MODES.includes(r.defaultMode as MarkdownStored['defaultMode'])) return null;
    out.defaultMode = r.defaultMode as MarkdownStored['defaultMode'];
  }
  if (r.readingWidth !== undefined) {
    if (!validWidth(r.readingWidth)) return null;
    out.readingWidth = r.readingWidth;
  }
  if (r.zoom !== undefined) {
    if (!validZoom(r.zoom)) return null;
    out.zoom = r.zoom;
  }
  if (r.mermaid !== undefined) {
    if (typeof r.mermaid !== 'boolean') return null;
    out.mermaid = r.mermaid;
  }
  return out;
}

/** The stored settings with every field filled; invalid stored data gives the defaults. */
export const markdownStoredOf = (raw: unknown): MarkdownStored => ({ ...MARKDOWN_STORED_DEFAULTS, ...validMarkdown(raw) });
