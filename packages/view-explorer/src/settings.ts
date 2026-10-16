import { DEFAULT_FORMAT_OPTIONS, type SqlFormatOptions } from '@deckbuilderkit/editor/options';
import type { CopyFormat, SqlRunnerSettings } from '@deckbuilderkit/sql-ui';
import { DEFAULT_RESULT_FORMAT, FILE_DEFAULTS, fileBoolSetting, fileEnumSetting, fileSettingsOf, type FileSettings, type GitSettings, type LogSettings, type ResultFormat, type SectionPath, type SettingDef, SORT_ORDERS } from '@deckbuilderkit/ui';

import type { ExplorerSettings } from './explorer-state';

export type { ExplorerSettings };

/** The part of the Workbench state the Explorer reads (SQL files) and writes (`doc`, to open a file there). */
export interface ExplorerWorkbench {
  /** Project ids allowed to run SQL from the Explorer. */
  explorerProjects: string[];
  maxRows: number;
  results: Partial<ResultFormat>;
  copyFormat: CopyFormat;
  confirmDestructive: boolean;
  queryTimeout: number;
  format: Partial<SqlFormatOptions>;
  doc: { kind: 'default' } | { kind: 'file'; project: string; path: string };
}

/** The part of the app settings the Explorer reads and writes; the app's `Settings` extends it. */
export interface ExplorerViewSettings {
  /** State of the Explorer screen; the server validates it. */
  explorer?: ExplorerSettings;
  /** Log viewer: highlight words and bookmarks (keyed `<projectId>:<path>`). */
  logs?: LogSettings;
  /** How text files are saved and how the Explorer shows files. */
  files?: FileSettings;
  /** Read only: the editor's word wrap. */
  editor?: { wordWrap?: boolean };
  /** Read only: closing dirty tabs. */
  general?: { confirmCloseDirty?: boolean };
  /** Read only: the sidebar side of the app's window settings. */
  window?: { sidebarSide?: 'left' | 'right' };
  /** Read only: the REST view's active environment, whose variables `.curl` files use. */
  rest?: { environment?: string };
  /** Read only: the shared git group. */
  git?: GitSettings;
  /** The Workbench state, for SQL files. */
  workbench?: Partial<ExplorerWorkbench>;
}

export const editorSettingsOf = (s: ExplorerViewSettings) => ({ wordWrap: s.editor?.wordWrap ?? true });
export const generalSettingsOf = (s: ExplorerViewSettings) => ({ confirmCloseDirty: s.general?.confirmCloseDirty ?? true });
export const windowSettingsOf = (s: ExplorerViewSettings) => ({ sidebarSide: s.window?.sidebarSide ?? 'left' });

const DEFAULT_MAX_ROWS = 1000;

/** The stored Workbench state with every field the Explorer reads filled with its default. */
export const withWorkbenchDefaults = (raw?: Partial<ExplorerWorkbench>) => ({
  ...raw,
  explorerProjects: raw?.explorerProjects ?? [],
  maxRows: raw?.maxRows ?? DEFAULT_MAX_ROWS,
  results: { ...DEFAULT_RESULT_FORMAT, ...raw?.results },
  copyFormat: raw?.copyFormat ?? ('tsv' satisfies CopyFormat),
  confirmDestructive: raw?.confirmDestructive ?? true,
  queryTimeout: raw?.queryTimeout ?? 0,
  format: { ...DEFAULT_FORMAT_OPTIONS, ...raw?.format },
});

export const sqlRunnerSettings = (s: ReturnType<typeof withWorkbenchDefaults>): SqlRunnerSettings => ({
  maxRows: s.maxRows,
  results: s.results,
  copyFormat: s.copyFormat,
  confirmDestructive: s.confirmDestructive,
  queryTimeout: s.queryTimeout,
});

const explorer: SectionPath = ['explorer'];

/** The `files.*` rows of the Explorer section; the editor's saving rows stay with the app. */
export const explorerSettingDefs: SettingDef<ExplorerViewSettings>[] = [
  fileBoolSetting('previewTabs', explorer, 10, 'settings.explorer.previewTabs'),
  fileBoolSetting('autoReveal', explorer, 20, 'settings.explorer.autoReveal'),
  fileBoolSetting('breadcrumbs', explorer, 30, 'settings.explorer.breadcrumbs'),
  fileBoolSetting('compactFolders', explorer, 40, 'settings.explorer.compact'),
  fileEnumSetting('sortOrder', explorer, 50, 'settings.explorer.sort', SORT_ORDERS),
  fileBoolSetting('fileNesting', explorer, 60, 'settings.explorer.nesting'),
  {
    id: 'files.nestingPatterns',
    kind: 'custom',
    section: explorer,
    order: 70,
    label: 'settings.explorer.nesting.patterns',
    description: 'settings.explorer.nesting.patterns.hint',
    default: FILE_DEFAULTS.nestingPatterns,
    get: (s) => fileSettingsOf(s.files).nestingPatterns,
    set: (s, v) => ({ files: { ...fileSettingsOf(s.files), nestingPatterns: v as Record<string, string> } }),
  },
  {
    id: 'files.exclude',
    kind: 'custom',
    section: explorer,
    order: 80,
    label: 'settings.explorer.exclude',
    description: 'settings.explorer.exclude.hint',
    default: FILE_DEFAULTS.exclude,
    get: (s) => fileSettingsOf(s.files).exclude,
    set: (s, v) => ({ files: { ...fileSettingsOf(s.files), exclude: v as string[] } }),
  },
  fileBoolSetting('confirmDelete', explorer, 90, 'settings.explorer.confirmDelete'),
  fileBoolSetting('confirmDragDrop', explorer, 100, 'settings.explorer.confirmDragDrop'),
  fileBoolSetting('showHidden', explorer, 110, 'settings.explorer.showHidden'),
  fileBoolSetting('restoreTabs', explorer, 120, 'settings.explorer.restoreTabs'),
  fileBoolSetting('markdownToc', explorer, 130, 'settings.explorer.markdownToc'),
];
