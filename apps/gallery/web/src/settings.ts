import { DEFAULT_FORMAT_OPTIONS, FORMAT_OPTION_META, type SqlFormatOptions } from '@deckbuilder/editor';
import {
  AUTO_SAVE,
  DEFAULT_RESULT_FORMAT,
  FILE_DEFAULTS,
  SORT_ORDERS,
  type BooleanSetting,
  type EnumSetting,
  type FileSettings,
  type ResultFormat,
  type SectionPath,
  type SettingDef,
  createSettingsRegistry,
  fileSettingsOf,
  registerDefaultSections,
  settingsFromOptionMeta,
} from '@deckbuilder/ui';
import type { Settings } from './api';
import { COPY_FORMATS, type CopyFormat } from './screens/workbench/copy-format';

export const settingsRegistry = createSettingsRegistry<Settings>();
registerDefaultSections(settingsRegistry);

/** Default of a registered setting. */
export const settingDefault = <V = unknown>(id: string): V => settingsRegistry.setting(id)!.default as V;

/** Defaults of the settings `<prefix>.<key>` as `{ key: default }`. */
export const settingDefaults = <O>(prefix: string): O =>
  Object.fromEntries(
    settingsRegistry
      .settings()
      .filter((s) => s.id.startsWith(`${prefix}.`))
      .map((s) => [s.id.slice(prefix.length + 1), s.default]),
  ) as O;

const MAX_ROWS_LIMIT = 100_000;

const general: SectionPath = ['general'];
const editor: SectionPath = ['editor'];
const explorer: SectionPath = ['explorer'];
const workbench: SectionPath = ['workbench'];
const results: SectionPath = ['workbench', 'results'];
const sqlFormatter: SectionPath = ['workbench', 'sqlFormatter'];

const fileGet = <K extends keyof FileSettings>(k: K) => (s: Settings) => fileSettingsOf(s.files)[k] as Required<FileSettings>[K];
const fileSet = (k: keyof FileSettings) => (s: Settings, v: unknown): Partial<Settings> => ({ files: { ...fileSettingsOf(s.files), [k]: v } });

type FileBool = 'trimTrailingWhitespace' | 'insertFinalNewline' | 'previewTabs' | 'autoReveal' | 'breadcrumbs' | 'compactFolders' | 'fileNesting';

const fileBool = (key: FileBool, section: SectionPath, order: number, label: string): BooleanSetting<Settings> => ({
  id: `files.${key}`,
  kind: 'boolean',
  section,
  order,
  label,
  description: `${label}.hint`,
  default: FILE_DEFAULTS[key],
  get: fileGet(key),
  set: fileSet(key),
});

const fileEnum = <K extends 'autoSave' | 'sortOrder'>(key: K, section: SectionPath, order: number, label: string, values: readonly Required<FileSettings>[K][]): EnumSetting<Settings> => ({
  id: `files.${key}`,
  kind: 'enum',
  section,
  order,
  label,
  description: `${label}.hint`,
  default: FILE_DEFAULTS[key],
  values,
  get: fileGet(key),
  set: fileSet(key),
});

const withWorkbench = (s: Settings, patch: Record<string, unknown>): Partial<Settings> => ({ workbench: { ...s.workbench, ...patch } });

type ResultText = 'nullText' | 'dateFormat' | 'timestampFormat';

const resultText = (key: ResultText, order: number): SettingDef<Settings> => ({
  id: `workbench.results.${key}`,
  kind: 'string',
  section: results,
  order,
  label: `settings.workbench.results.${key}`,
  default: DEFAULT_RESULT_FORMAT[key],
  get: (s) => s.workbench?.results?.[key] ?? DEFAULT_RESULT_FORMAT[key],
  set: (s, v) => withWorkbench(s, { results: { ...DEFAULT_RESULT_FORMAT, ...s.workbench?.results, [key]: v } satisfies ResultFormat }),
});

const resultBool = (key: 'hideMidnight' | 'thousandsSeparator', order: number, label: string, description: string): SettingDef<Settings> => ({
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

settingsRegistry.registerSettings([
  {
    id: 'general.autostart',
    kind: 'boolean',
    section: general,
    order: 10,
    label: 'settings.autostart',
    description: 'settings.autostart.hint',
    default: false,
    get: (s) => s.autostart,
    set: (_, autostart) => ({ autostart }),
  },
  {
    id: 'general.closeToTray',
    kind: 'boolean',
    section: general,
    order: 20,
    label: 'settings.closeToTray',
    description: 'settings.closeToTray.hint',
    default: false,
    get: (s) => s.closeToTray,
    set: (_, closeToTray) => ({ closeToTray }),
  },

  fileEnum('autoSave', editor, 10, 'settings.explorer.autoSave', AUTO_SAVE),
  fileBool('trimTrailingWhitespace', editor, 20, 'settings.explorer.trim'),
  fileBool('insertFinalNewline', editor, 30, 'settings.explorer.finalNewline'),

  fileBool('previewTabs', explorer, 10, 'settings.explorer.previewTabs'),
  fileBool('autoReveal', explorer, 20, 'settings.explorer.autoReveal'),
  fileBool('breadcrumbs', explorer, 30, 'settings.explorer.breadcrumbs'),
  fileBool('compactFolders', explorer, 40, 'settings.explorer.compact'),
  fileEnum('sortOrder', explorer, 50, 'settings.explorer.sort', SORT_ORDERS),
  fileBool('fileNesting', explorer, 60, 'settings.explorer.nesting'),
  { id: 'files.nestingPatterns', kind: 'custom', section: explorer, order: 70, label: 'settings.explorer.nesting.patterns', description: 'settings.explorer.nesting.patterns.hint', default: FILE_DEFAULTS.nestingPatterns },
  { id: 'files.exclude', kind: 'custom', section: explorer, order: 80, label: 'settings.explorer.exclude', description: 'settings.explorer.exclude.hint', default: FILE_DEFAULTS.exclude },

  { id: 'workbench.explorerProjects', kind: 'custom', section: workbench, order: 10, label: 'settings.workbench.projects', description: 'settings.workbench.projects.hint', default: [] as string[] },
  {
    id: 'workbench.maxRows',
    kind: 'number',
    section: workbench,
    order: 20,
    label: 'settings.workbench.maxRows',
    default: 1000,
    min: 1,
    max: MAX_ROWS_LIMIT,
    get: (s) => s.workbench?.maxRows ?? 1000,
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

  resultText('nullText', 10),
  resultText('dateFormat', 20),
  resultBool('hideMidnight', 30, 'settings.workbench.results.hideMidnight', 'settings.workbench.results.hideMidnight.hint'),
  resultText('timestampFormat', 40),
  resultBool('thousandsSeparator', 50, 'settings.workbench.results.thousands', 'settings.workbench.results.hint'),

  ...settingsFromOptionMeta<Settings, { [K in keyof SqlFormatOptions]: SqlFormatOptions[K] }>({
    meta: FORMAT_OPTION_META,
    defaults: DEFAULT_FORMAT_OPTIONS,
    idPrefix: 'workbench.format',
    section: sqlFormatter,
    labelPrefix: 'settings.workbench.format.',
    get: (s) => ({ ...DEFAULT_FORMAT_OPTIONS, ...s.workbench?.format }),
    set: (s, format) => withWorkbench(s, { format }),
  }),
]);
