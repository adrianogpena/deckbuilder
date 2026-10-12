import { isRecord } from '@deckbuilder/server-core/protocol';

export type AutoSave = 'off' | 'afterDelay' | 'onFocusChange';
export const AUTO_SAVE: readonly AutoSave[] = ['off', 'afterDelay', 'onFocusChange'];

/** How text files are saved, like VS Code's `files.*` settings. Omitted fields take `FILE_DEFAULTS`. */
export interface FileSettings {
  /** Save a changed file after a delay, or when its tab or the window loses focus. */
  autoSave?: AutoSave;
  /** Remove spaces and tabs at line ends on save (not in Markdown, where two spaces are a line break). */
  trimTrailingWhitespace?: boolean;
  /** End the file with a line break on save. */
  insertFinalNewline?: boolean;
  /** A single click on a file opens a preview tab that the next click replaces; double-click, editing or double-clicking the tab keeps it. */
  previewTabs?: boolean;
  /** Show the active file in the Explorer tree when its tab is selected. */
  autoReveal?: boolean;
  /** Show the path above the editor as clickable segments. */
  breadcrumbs?: boolean;
}

export const FILE_DEFAULTS: Required<FileSettings> = {
  autoSave: 'off',
  trimTrailingWhitespace: false,
  insertFinalNewline: false,
  previewTabs: true,
  autoReveal: true,
  breadcrumbs: true,
};

/** `raw` with the defaults filled in; fields of the wrong type fall back to their default. */
export function fileSettingsOf(raw: FileSettings | undefined): Required<FileSettings> {
  return { ...FILE_DEFAULTS, ...(raw && validFileSettings(raw)) };
}

/** A copy of `raw` keeping only the well-formed fields; null when it isn't an object. */
export function validFileSettings(raw: unknown): FileSettings | null {
  if (!isRecord(raw)) return null;
  const out: FileSettings = {};
  if (AUTO_SAVE.includes(raw.autoSave as AutoSave)) out.autoSave = raw.autoSave as AutoSave;
  if (typeof raw.trimTrailingWhitespace === 'boolean') out.trimTrailingWhitespace = raw.trimTrailingWhitespace;
  if (typeof raw.insertFinalNewline === 'boolean') out.insertFinalNewline = raw.insertFinalNewline;
  if (typeof raw.previewTabs === 'boolean') out.previewTabs = raw.previewTabs;
  if (typeof raw.autoReveal === 'boolean') out.autoReveal = raw.autoReveal;
  if (typeof raw.breadcrumbs === 'boolean') out.breadcrumbs = raw.breadcrumbs;
  return out;
}
