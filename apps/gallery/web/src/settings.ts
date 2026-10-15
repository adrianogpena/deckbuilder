import { DEFAULT_FORMAT_OPTIONS, FORMAT_OPTION_META, type SqlFormatOptions } from '@deckbuilder/editor/options';
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
import type { TerminalProfile } from '@deckbuilder/terminal/protocol';
import type { AppearanceSettings, EditorSettings, GeneralSettings, GitSettings, KeyboardSettings, Settings, TerminalSettings, WindowSettings } from './api';
import { SCREENS } from './nav';
import { DEFAULT_WORD_SEPARATORS, TERMINAL_THEMES, type ColorScheme } from '@deckbuilder/terminal/options';
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
const rest: SectionPath = ['rest'];
const results: SectionPath = ['workbench', 'results'];
const sqlFormatter: SectionPath = ['workbench', 'sqlFormatter'];

const fileGet = <K extends keyof FileSettings>(k: K) => (s: Settings) => fileSettingsOf(s.files)[k] as Required<FileSettings>[K];
const fileSet = (k: keyof FileSettings) => (s: Settings, v: unknown): Partial<Settings> => ({ files: { ...fileSettingsOf(s.files), [k]: v } });

type FileBool = 'trimTrailingWhitespace' | 'insertFinalNewline' | 'previewTabs' | 'autoReveal' | 'breadcrumbs' | 'compactFolders' | 'fileNesting' | 'confirmDelete' | 'confirmDragDrop' | 'showHidden' | 'restoreTabs' | 'markdownToc';

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

type Group = 'appearance' | 'editor' | 'terminal' | 'window' | 'general' | 'keyboard' | 'git';

type FieldDef =
  | { kind: 'boolean'; default: boolean }
  | { kind: 'string'; default: string }
  | { kind: 'number'; default: number; min: number; max: number }
  | { kind: 'enum'; default: string; values: readonly string[] };

const groupField = (group: Group, key: string, order: number, def: FieldDef, section: SectionPath = [group]): SettingDef<Settings> => {
  const read = (s: Settings) => (s[group] as Record<string, unknown> | undefined)?.[key] ?? def.default;
  const set = (s: Settings, v: unknown): Partial<Settings> => ({ [group]: { ...s[group], [key]: v } });
  return {
    id: `${group}.${key}`,
    section,
    order,
    label: `settings.${group}.${key}`,
    description: `settings.${group}.${key}.hint`,
    ...def,
    get: read,
    set,
  } as unknown as SettingDef<Settings>;
};

const FONT_WEIGHTS = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
const MONO_FONT = "'Geist Mono','Cascadia Code',Consolas,monospace";
const bool = (default_: boolean): FieldDef => ({ kind: 'boolean', default: default_ });
const str = (default_: string): FieldDef => ({ kind: 'string', default: default_ });
const num = (default_: number, min: number, max: number): FieldDef => ({ kind: 'number', default: default_, min, max });
const oneOf = (default_: string, values: readonly string[]): FieldDef => ({ kind: 'enum', default: default_, values });

settingsRegistry.registerSettings([
  groupField('appearance', 'uiFontFamily', 100, str("'Geist', 'Segoe UI', system-ui, sans-serif")),
  groupField('appearance', 'editorFontFamily', 110, str(MONO_FONT)),
  groupField('appearance', 'editorFontSize', 120, num(12.5, 8, 32)),
  groupField('appearance', 'editorLineHeight', 130, num(1.55, 1, 3)),
  groupField('appearance', 'editorLigatures', 140, bool(false)),
  groupField('appearance', 'reduceMotion', 150, bool(false)),

  groupField('editor', 'tabSize', 100, num(4, 1, 8)),
  groupField('editor', 'insertSpaces', 110, bool(true)),
  groupField('editor', 'wordWrap', 120, bool(true)),
  groupField('editor', 'lineNumbers', 130, bool(true)),
  groupField('editor', 'highlightActiveLine', 140, bool(true)),
  groupField('editor', 'renderWhitespace', 150, oneOf('none', ['none', 'selection', 'all'])),
  groupField('editor', 'bracketMatching', 160, bool(true)),
  groupField('editor', 'autoCloseBrackets', 170, bool(true)),
  groupField('editor', 'cursorStyle', 180, oneOf('line', ['line', 'block', 'underline'])),
  groupField('editor', 'cursorBlink', 190, bool(true)),

  groupField('window', 'sidebarSide', 100, oneOf('left', ['left', 'right'])),
  groupField('window', 'statusBar', 110, bool(true)),
  groupField('window', 'tabSizing', 120, oneOf('fit', ['fit', 'shrink'])),
  groupField('window', 'tabCloseButton', 130, oneOf('right', ['right', 'left', 'hidden'])),
  groupField('window', 'tabIcons', 140, bool(true)),

  groupField('general', 'confirmCloseDirty', 100, bool(true)),
  groupField('general', 'toastDuration', 110, num(4000, 1000, 60_000)),
  groupField('general', 'startScreen', 120, oneOf('home', [...SCREENS])),

  groupField('keyboard', 'chordTimeout', 100, num(1500, 500, 10_000)),

  groupField('git', 'diffMode', 100, oneOf('split', ['split', 'inline'])),
  groupField('git', 'explorerDecorations', 110, bool(true), explorer),

  groupField('terminal', 'fontFamily', 100, str(MONO_FONT), ['terminal', 'appearance']),
  groupField('terminal', 'fontSize', 110, num(13, 8, 32), ['terminal', 'appearance']),
  groupField('terminal', 'cursorStyle', 120, oneOf('block', ['block', 'bar', 'underline']), ['terminal', 'appearance']),
  groupField('terminal', 'cursorBlink', 130, bool(true), ['terminal', 'appearance']),
  groupField('terminal', 'scrollback', 140, num(5000, 100, 100_000), ['terminal', 'behavior']),
  groupField('terminal', 'copyOnSelect', 150, bool(false), ['terminal', 'behavior']),
  groupField('terminal', 'rightClickPaste', 160, bool(false), ['terminal', 'behavior']),
  groupField('terminal', 'lineHeight', 170, num(1, 1, 2), ['terminal', 'appearance']),
  groupField('terminal', 'letterSpacing', 180, num(0, 0, 10), ['terminal', 'appearance']),
  groupField('terminal', 'fontWeight', 190, oneOf('normal', FONT_WEIGHTS), ['terminal', 'appearance']),
  groupField('terminal', 'fontWeightBold', 200, oneOf('bold', FONT_WEIGHTS), ['terminal', 'appearance']),
  groupField('terminal', 'ligatures', 210, bool(false), ['terminal', 'appearance']),
  groupField('terminal', 'theme', 220, oneOf('app', TERMINAL_THEMES), ['terminal', 'appearance']),
  groupField('terminal', 'minimumContrastRatio', 230, num(1, 1, 21), ['terminal', 'appearance']),
  groupField('terminal', 'gpuAcceleration', 240, oneOf('auto', ['auto', 'on', 'off']), ['terminal', 'appearance']),
  groupField('terminal', 'padding', 250, num(8, 0, 48), ['terminal', 'appearance']),
  groupField('terminal', 'scrollbar', 260, oneOf('visible', ['visible', 'hover', 'hidden']), ['terminal', 'appearance']),
  groupField('terminal', 'dimUnfocused', 270, num(0, 0, 80), ['terminal', 'appearance']),
  { id: 'terminal.schemes', kind: 'custom', section: ['terminal', 'appearance'], order: 280, label: 'settings.terminal.schemes', description: 'settings.terminal.schemes.hint', default: [] as ColorScheme[] },
  groupField('terminal', 'wordSeparators', 300, str(DEFAULT_WORD_SEPARATORS), ['terminal', 'behavior']),
  groupField('terminal', 'scrollSensitivity', 310, num(1, 1, 10), ['terminal', 'behavior']),
  groupField('terminal', 'fastScrollSensitivity', 320, num(5, 1, 20), ['terminal', 'behavior']),
  groupField('terminal', 'altIsMeta', 330, bool(false), ['terminal', 'behavior']),
  groupField('terminal', 'pasteWarning', 335, oneOf('multiLine', ['multiLine', 'large', 'never']), ['terminal', 'behavior']),
  groupField('terminal', 'pasteLargeSize', 336, num(5120, 256, 1_000_000), ['terminal', 'behavior']),
  groupField('terminal', 'trimCopy', 337, bool(true), ['terminal', 'behavior']),
  groupField('terminal', 'bellStyle', 340, oneOf('tab', ['tab', 'sound', 'both', 'none']), ['terminal', 'tabs']),
  groupField('terminal', 'restoreTabs', 400, bool(true), ['terminal', 'tabs']),
  groupField('terminal', 'tabTitle', 410, str('{name}'), ['terminal', 'tabs']),
  groupField('terminal', 'defaultProfile', 420, str(''), ['terminal', 'profiles']),
  groupField('terminal', 'defaultCwd', 430, str(''), ['terminal', 'profiles']),
  groupField('terminal', 'onExit', 440, oneOf('keep', ['keep', 'close', 'closeIfClean', 'restart']), ['terminal', 'tabs']),
  groupField('terminal', 'confirmCloseRunning', 450, bool(true), ['terminal', 'tabs']),
  groupField('terminal', 'shellIntegration', 500, bool(true), ['terminal', 'profiles']),
  groupField('terminal', 'commandDecorations', 510, bool(true), ['terminal', 'profiles']),
  { id: 'terminal.profiles', kind: 'custom', section: ['terminal', 'profiles'], order: 600, label: 'settings.terminal.profiles', description: 'settings.terminal.profiles.hint', default: [] as TerminalProfile[] },

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
  {
    id: 'general.rememberSettingsPage',
    kind: 'boolean',
    section: general,
    order: 30,
    label: 'settings.rememberPage',
    description: 'settings.rememberPage.hint',
    default: true,
    get: (s) => s.rememberSettingsPage ?? true,
    set: (_, rememberSettingsPage) => ({ rememberSettingsPage }),
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
  fileBool('confirmDelete', explorer, 90, 'settings.explorer.confirmDelete'),
  fileBool('confirmDragDrop', explorer, 100, 'settings.explorer.confirmDragDrop'),
  fileBool('showHidden', explorer, 110, 'settings.explorer.showHidden'),
  fileBool('restoreTabs', explorer, 120, 'settings.explorer.restoreTabs'),
  fileBool('markdownToc', explorer, 130, 'settings.explorer.markdownToc'),

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

  {
    id: 'rest.historySize',
    kind: 'number',
    section: rest,
    order: 10,
    label: 'settings.rest.historySize',
    description: 'settings.rest.historySize.hint',
    default: 100,
    min: 0,
    max: 5000,
    get: (s) => s.rest?.historySize ?? 100,
    set: (s, historySize) => ({ rest: { ...s.rest, historySize } }),
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

/** The appearance settings with their defaults filled in. */
export const appearanceSettingsOf = (s: Settings): Required<AppearanceSettings> => ({ ...settingDefaults<Required<AppearanceSettings>>('appearance'), ...s.appearance });

/** The editor settings with their defaults filled in. */
export const editorSettingsOf = (s: Settings): Required<EditorSettings> => ({ ...settingDefaults<Required<EditorSettings>>('editor'), ...s.editor });

/** The terminal look and behavior settings (not the shell) with their defaults filled in. */
export const terminalSettingsOf = (s: Settings): Required<TerminalSettings> => {
  const { shell: _shell, ...fields } = s.terminal ?? {};
  return { ...settingDefaults<Required<TerminalSettings>>('terminal'), ...fields };
};

/** The window settings with their defaults filled in. */
export const windowSettingsOf = (s: Settings): Required<WindowSettings> => ({ ...settingDefaults<Required<WindowSettings>>('window'), ...s.window });

/** The keyboard settings with their defaults filled in. */
export const keyboardSettingsOf = (s: Settings): Required<KeyboardSettings> => ({ ...settingDefaults<Required<KeyboardSettings>>('keyboard'), ...s.keyboard });

/** The git settings with their defaults filled in. */
export const gitSettingsOf = (s: Settings): Required<GitSettings> => ({ ...settingDefaults<Required<GitSettings>>('git'), ...s.git });

/** The settings stored in `general` (autostart and the other top-level ones are not) with their defaults filled in. */
export const generalSettingsOf = (s: Settings): Required<GeneralSettings> => ({
  confirmCloseDirty: s.general?.confirmCloseDirty ?? settingDefault<boolean>('general.confirmCloseDirty'),
  toastDuration: s.general?.toastDuration ?? settingDefault<number>('general.toastDuration'),
  startScreen: s.general?.startScreen ?? settingDefault<string>('general.startScreen'),
});
