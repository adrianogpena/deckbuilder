import { DEFAULT_FORMAT_OPTIONS, FORMAT_OPTION_META, type SqlFormatOptions } from '@deckbuilder/editor/options';
import { COPY_FORMATS, type CopyFormat, type SqlRunnerSettings } from '@deckbuilder/sql-ui';
import { DEFAULT_RESULT_FORMAT, type ResultFormat, type SectionPath, type SettingDef, settingsFromOptionMeta } from '@deckbuilder/ui';

export type WorkbenchDoc = { kind: 'default' } | { kind: 'file'; project: string; path: string };

/** The stored Workbench state. */
export interface WorkbenchSettings {
  sizes?: { main: [number, number]; results: [number, number] };
  widths?: Record<string, number>;
  /** `'demo'` or a database connection id. */
  source?: string;
  /** Most rows a database query returns. */
  maxRows?: number;
  /** The schema sidebar is open. */
  schema?: boolean;
  /** The SQL steps sidebar is open. */
  steps?: boolean;
  /** Width of the SQL steps sidebar in px. */
  stepsWidth?: number;
  /** The SQL history sidebar is open. */
  history?: boolean;
  /** Project ids allowed to run SQL from the Explorer. */
  explorerProjects: string[];
  /** How result cells are shown and copied; exports stay raw. */
  results: ResultFormat;
  /** Format of "Copy results". */
  copyFormat: CopyFormat;
  /** Ask before DROP, TRUNCATE, or a DELETE or UPDATE without WHERE. */
  confirmDestructive?: boolean;
  /** Seconds to wait for a database statement; 0 means no limit. */
  queryTimeout?: number;
  /** Statements kept in the SQL history; 0 turns history off. */
  historySize?: number;
  /** SQL formatter options. */
  format: SqlFormatOptions;
  /** The document the editor edits: the connection's default script (also when omitted) or a project file. */
  doc?: WorkbenchDoc;
}

/** The part of the app settings the Workbench view reads and writes; the app's `Settings` extends it. */
export interface WorkbenchViewSettings {
  /** State of the Workbench screen; the server validates it. */
  workbench?: Partial<WorkbenchSettings>;
}

const MAX_ROWS_LIMIT = 100_000;
const DEFAULT_MAX_ROWS = 1000;
const workbench: SectionPath = ['workbench'];
const results: SectionPath = ['workbench', 'results'];
const sqlFormatter: SectionPath = ['workbench', 'sqlFormatter'];

const withWorkbench = (s: WorkbenchViewSettings, patch: Record<string, unknown>): Partial<WorkbenchViewSettings> => ({ workbench: { ...s.workbench, ...patch } });

type ResultText = 'nullText' | 'dateFormat' | 'timestampFormat';

const resultText = (key: ResultText, order: number): SettingDef<WorkbenchViewSettings> => ({
  id: `workbench.results.${key}`,
  kind: 'string',
  section: results,
  order,
  label: `settings.workbench.results.${key}`,
  default: DEFAULT_RESULT_FORMAT[key],
  get: (s) => s.workbench?.results?.[key] ?? DEFAULT_RESULT_FORMAT[key],
  set: (s, v) => withWorkbench(s, { results: { ...DEFAULT_RESULT_FORMAT, ...s.workbench?.results, [key]: v } satisfies ResultFormat }),
});

const resultBool = (key: 'hideMidnight' | 'thousandsSeparator', order: number, label: string, description: string): SettingDef<WorkbenchViewSettings> => ({
  id: `workbench.results.${key}`,
  kind: 'boolean',
  section: results,
  order,
  label,
  description,
  default: DEFAULT_RESULT_FORMAT[key],
  get: (s) => s.workbench?.results?.[key] ?? DEFAULT_RESULT_FORMAT[key],
  set: (s, v) => withWorkbench(s, { results: { ...DEFAULT_RESULT_FORMAT, ...s.workbench?.results, [key]: v } satisfies ResultFormat }),
});

export const workbenchSettingDefs: SettingDef<WorkbenchViewSettings>[] = [
  { id: 'workbench.explorerProjects', kind: 'custom', section: workbench, order: 10, label: 'settings.workbench.projects', description: 'settings.workbench.projects.hint', default: [] as string[] },
  {
    id: 'workbench.maxRows',
    kind: 'number',
    section: workbench,
    order: 20,
    label: 'settings.workbench.maxRows',
    default: DEFAULT_MAX_ROWS,
    min: 1,
    max: MAX_ROWS_LIMIT,
    get: (s) => s.workbench?.maxRows ?? DEFAULT_MAX_ROWS,
    set: (s, maxRows) => withWorkbench(s, { maxRows }),
  },
  {
    id: 'workbench.copyFormat',
    kind: 'enum',
    section: workbench,
    order: 30,
    label: 'settings.workbench.copyFormat',
    default: 'tsv' satisfies CopyFormat as string,
    values: COPY_FORMATS as readonly string[],
    get: (s) => s.workbench?.copyFormat ?? 'tsv',
    set: (s, copyFormat) => withWorkbench(s, { copyFormat }),
  },
  {
    id: 'workbench.confirmDestructive',
    kind: 'boolean',
    section: workbench,
    order: 22,
    label: 'settings.workbench.confirmDestructive',
    description: 'settings.workbench.confirmDestructive.hint',
    default: true,
    get: (s) => s.workbench?.confirmDestructive ?? true,
    set: (s, confirmDestructive) => withWorkbench(s, { confirmDestructive }),
  },
  {
    id: 'workbench.queryTimeout',
    kind: 'number',
    section: workbench,
    order: 24,
    label: 'settings.workbench.queryTimeout',
    description: 'settings.workbench.queryTimeout.hint',
    default: 0,
    min: 0,
    max: 3600,
    get: (s) => s.workbench?.queryTimeout ?? 0,
    set: (s, queryTimeout) => withWorkbench(s, { queryTimeout }),
  },
  {
    id: 'workbench.historySize',
    kind: 'number',
    section: workbench,
    order: 26,
    label: 'settings.workbench.historySize',
    description: 'settings.workbench.historySize.hint',
    default: 500,
    min: 0,
    max: 10000,
    get: (s) => s.workbench?.historySize ?? 500,
    set: (s, historySize) => withWorkbench(s, { historySize }),
  },
  resultText('nullText', 10),
  resultText('dateFormat', 20),
  resultBool('hideMidnight', 30, 'settings.workbench.results.hideMidnight', 'settings.workbench.results.hideMidnight.hint'),
  resultText('timestampFormat', 40),
  resultBool('thousandsSeparator', 50, 'settings.workbench.results.thousands', 'settings.workbench.results.hint'),
  ...settingsFromOptionMeta<WorkbenchViewSettings, { [K in keyof SqlFormatOptions]: SqlFormatOptions[K] }>({
    meta: FORMAT_OPTION_META,
    defaults: DEFAULT_FORMAT_OPTIONS,
    idPrefix: 'workbench.format',
    section: sqlFormatter,
    labelPrefix: 'settings.workbench.format.',
    get: (s) => ({ ...DEFAULT_FORMAT_OPTIONS, ...s.workbench?.format }),
    set: (s, format) => withWorkbench(s, { format }),
  }),
];

/** The stored workbench state with every missing field filled with its default. */
export const withWorkbenchDefaults = (raw?: Partial<WorkbenchSettings>): WorkbenchSettings => ({
  ...raw,
  explorerProjects: raw?.explorerProjects ?? [],
  results: { ...DEFAULT_RESULT_FORMAT, ...raw?.results },
  copyFormat: raw?.copyFormat ?? 'tsv',
  confirmDestructive: raw?.confirmDestructive ?? true,
  queryTimeout: raw?.queryTimeout ?? 0,
  historySize: raw?.historySize ?? 500,
  format: { ...DEFAULT_FORMAT_OPTIONS, ...raw?.format },
});

/** The runner's options from the stored workbench settings, missing ones taken from the defaults. */
export const sqlRunnerSettings = (s: Pick<WorkbenchSettings, 'results'> & Partial<Pick<WorkbenchSettings, 'maxRows' | 'copyFormat' | 'confirmDestructive' | 'queryTimeout'>>): SqlRunnerSettings => ({
  maxRows: s.maxRows ?? DEFAULT_MAX_ROWS,
  results: s.results,
  copyFormat: s.copyFormat,
  confirmDestructive: s.confirmDestructive ?? true,
  queryTimeout: s.queryTimeout,
});
