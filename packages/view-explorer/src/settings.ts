import { DEFAULT_FORMAT_OPTIONS, type SqlFormatOptions } from '@deckbuilder/editor/options';
import type { CopyFormat, SqlRunnerSettings } from '@deckbuilder/sql-ui';
import { DEFAULT_RESULT_FORMAT, type FileSettings, type GitSettings, type LogSettings, type ResultFormat } from '@deckbuilder/ui';

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
