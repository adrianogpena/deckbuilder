import { isRecord } from '@deckbuilder/server-core/protocol';
import { NESTING_DEFAULTS, type NestingPatterns } from './file-nesting';

export type AutoSave = 'off' | 'afterDelay' | 'onFocusChange';
export const AUTO_SAVE: readonly AutoSave[] = ['off', 'afterDelay', 'onFocusChange'];

export type SortOrder = 'default' | 'mixed' | 'filesFirst' | 'type' | 'modified';
export const SORT_ORDERS: readonly SortOrder[] = ['default', 'mixed', 'filesFirst', 'type', 'modified'];
const MAX_EXCLUDES = 100;

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
  /** A chain of folders that each hold only one folder shows as one row (`a/b/c`). */
  compactFolders?: boolean;
  /** Related files (a lock file, a test) show nested under a parent file, by `nestingPatterns`. */
  fileNesting?: boolean;
  /** Parent glob (one `*` at most) to comma separated child patterns, which may use `${capture}`, `${basename}`, `${extname}`, `${dirname}` and a `*`. */
  nestingPatterns?: NestingPatterns;
  /** Globs on the path from the project root (Bun.Glob syntax, so a leading double star matches at any depth); matching entries are hidden from the tree and from search. */
  exclude?: string[];
  /** How the tree orders the entries of a folder. */
  sortOrder?: SortOrder;
  /** Ask before deleting files; the warning about unsaved changes stays either way. */
  confirmDelete?: boolean;
  /** Ask before moving files by drag and drop. */
  confirmDragDrop?: boolean;
  /** Start with the excluded entries shown in the tree. */
  showHidden?: boolean;
  /** Reopen the tabs of the last session. */
  restoreTabs?: boolean;
  /** Show the heading rail beside rendered Markdown. */
  markdownToc?: boolean;
}

export const FILE_DEFAULTS: Required<FileSettings> = {
  autoSave: 'off',
  trimTrailingWhitespace: false,
  insertFinalNewline: false,
  previewTabs: true,
  autoReveal: true,
  breadcrumbs: true,
  compactFolders: true,
  fileNesting: false,
  nestingPatterns: NESTING_DEFAULTS,
  exclude: ['**/.git', '**/.DS_Store', '**/Thumbs.db'],
  sortOrder: 'default',
  confirmDelete: true,
  confirmDragDrop: false,
  showHidden: false,
  restoreTabs: true,
  markdownToc: true,
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
  if (typeof raw.compactFolders === 'boolean') out.compactFolders = raw.compactFolders;
  if (typeof raw.fileNesting === 'boolean') out.fileNesting = raw.fileNesting;
  if (typeof raw.confirmDelete === 'boolean') out.confirmDelete = raw.confirmDelete;
  if (typeof raw.confirmDragDrop === 'boolean') out.confirmDragDrop = raw.confirmDragDrop;
  if (typeof raw.showHidden === 'boolean') out.showHidden = raw.showHidden;
  if (typeof raw.restoreTabs === 'boolean') out.restoreTabs = raw.restoreTabs;
  if (typeof raw.markdownToc === 'boolean') out.markdownToc = raw.markdownToc;
  if (isRecord(raw.nestingPatterns)) {
    const entries = Object.entries(raw.nestingPatterns);
    if (entries.length <= MAX_EXCLUDES && entries.every(([k, v]) => k.trim() !== '' && k.length <= 200 && typeof v === 'string' && v.length <= 500)) {
      out.nestingPatterns = Object.fromEntries(entries.map(([k, v]) => [k.trim(), v as string]));
    }
  }
  if (Array.isArray(raw.exclude) && raw.exclude.length <= MAX_EXCLUDES && raw.exclude.every((g) => typeof g === 'string' && g.trim() !== '' && g.length <= 200)) {
    out.exclude = raw.exclude.map((g) => (g as string).trim());
  }
  if (SORT_ORDERS.includes(raw.sortOrder as SortOrder)) out.sortOrder = raw.sortOrder as SortOrder;
  return out;
}
