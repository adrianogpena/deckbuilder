import {
  AUTO_SAVE,
  FILE_DEFAULTS,
  SORT_ORDERS,
  type BooleanSetting,
  type EnumSetting,
  type FileSettings,
  type SectionPath,
  bool,
  createSettingsRegistry,
  gitSettingDefs,
  groupField as uiGroupField,
  num,
  oneOf,
  str,
  fileSettingsOf,
  registerDefaultSections,
} from '@deckbuilder/ui';
import type { AppearanceSettings, EditorSettings, GeneralSettings, KeyboardSettings, Settings, WindowSettings } from './api';

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

const general: SectionPath = ['general'];
const editor: SectionPath = ['editor'];
const explorer: SectionPath = ['explorer'];

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

type Group = 'appearance' | 'editor' | 'window' | 'general' | 'keyboard';

const groupField = (group: Group, key: string, order: number, def: Parameters<typeof uiGroupField>[3], section?: SectionPath) => uiGroupField<Settings, Group>(group, key, order, def, section);

const MONO_FONT = "'Geist Mono','Cascadia Code',Consolas,monospace";


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

  groupField('keyboard', 'chordTimeout', 100, num(1500, 500, 10_000)),

  ...gitSettingDefs,


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

]);

/** The appearance settings with their defaults filled in. */
export const appearanceSettingsOf = (s: Settings): Required<AppearanceSettings> => ({ ...settingDefaults<Required<AppearanceSettings>>('appearance'), ...s.appearance });

/** The editor settings with their defaults filled in. */
export const editorSettingsOf = (s: Settings): Required<EditorSettings> => ({ ...settingDefaults<Required<EditorSettings>>('editor'), ...s.editor });

/** The window settings with their defaults filled in. */
export const windowSettingsOf = (s: Settings): Required<WindowSettings> => ({ ...settingDefaults<Required<WindowSettings>>('window'), ...s.window });

/** The keyboard settings with their defaults filled in. */
export const keyboardSettingsOf = (s: Settings): Required<KeyboardSettings> => ({ ...settingDefaults<Required<KeyboardSettings>>('keyboard'), ...s.keyboard });

/** The settings stored in `general` (autostart and the other top-level ones are not) with their defaults filled in. */
export const generalSettingsOf = (s: Settings): Required<GeneralSettings> => ({
  confirmCloseDirty: s.general?.confirmCloseDirty ?? settingDefault<boolean>('general.confirmCloseDirty'),
  toastDuration: s.general?.toastDuration ?? settingDefault<number>('general.toastDuration'),
  startScreen: s.general?.startScreen ?? settingDefault<string>('general.startScreen'),
});
