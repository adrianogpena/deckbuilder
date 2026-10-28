/**
 * Settings schema: sections (the Settings menu tree) and settings (one entry per value), kept in a
 * registry so apps and packages can add their own. Orders use gaps of 10 so others can slot in between.
 */

/** A path in the section tree, e.g. `['workbench', 'sqlFormatter']`. */
export type SectionPath = readonly string[];

export interface SettingsSection {
  path: SectionPath;
  order: number;
  /** i18n key of the menu label. */
  label: string;
}

export interface SettingsSectionNode extends SettingsSection {
  children: SettingsSectionNode[];
}

interface SettingBase {
  /** Dotted id, e.g. `workbench.format.keywordCase`. */
  id: string;
  section: SectionPath;
  order: number;
}

interface ValueSettingBase<S, V> extends SettingBase {
  /** i18n key of the label. */
  label: string;
  /** i18n key of the description. */
  description?: string;
  default: V;
  get(settings: S): V;
  /** Returns the patch to apply to the settings object. */
  set(settings: S, value: V): Partial<S>;
  /** Overrides the default comparison for the modified mark (e.g. a setting that follows another until set). */
  modified?(settings: S): boolean;
  /** Overrides the reset patch (default: `set(settings, default)`). */
  reset?(settings: S): Partial<S>;
}

export interface BooleanSetting<S> extends ValueSettingBase<S, boolean> {
  kind: 'boolean';
}

export interface NumberSetting<S> extends ValueSettingBase<S, number> {
  kind: 'number';
  min?: number;
  max?: number;
}

export interface StringSetting<S> extends ValueSettingBase<S, string> {
  kind: 'string';
}

export type EnumValue = string | number;

export interface EnumSetting<S, V extends EnumValue = EnumValue> extends ValueSettingBase<S, V> {
  kind: 'enum';
  values: readonly V[];
}

/** A setting with no single get/set path (projects list, nesting patterns, exclude); its screen renders it. */
export interface CustomSetting<V = unknown, S = any> extends SettingBase {
  kind: 'custom';
  label?: string;
  description?: string;
  default: V;
  /** How the screen reads the value (modified marks) and resets it; without them the screen leaves the setting alone. */
  get?(settings: S): V;
  set?(settings: S, value: V): Partial<S>;
}

export type SettingDef<S> = BooleanSetting<S> | NumberSetting<S> | StringSetting<S> | EnumSetting<S> | CustomSetting<unknown, S>;

export const sectionKey = (path: SectionPath): string => path.join('.');

const isPrefix = (prefix: SectionPath, path: SectionPath) =>
  prefix.length <= path.length && prefix.every((p, i) => p === path[i]);

export interface SettingsRegistry<S> {
  registerSection(section: SettingsSection): void;
  registerSetting(setting: SettingDef<S>): void;
  registerSettings(settings: readonly SettingDef<S>[]): void;
  section(path: SectionPath): SettingsSection | undefined;
  /** Top-level sections with their children, each level sorted by `order`. */
  sectionTree(): SettingsSectionNode[];
  setting(id: string): SettingDef<S> | undefined;
  /** Settings directly in `path` (or also in its subsections with `deep`), sorted by `order`. */
  settingsIn(path: SectionPath, deep?: boolean): SettingDef<S>[];
  settings(): SettingDef<S>[];
}

export function createSettingsRegistry<S>(): SettingsRegistry<S> {
  const sections = new Map<string, SettingsSection>();
  const settings = new Map<string, SettingDef<S>>();
  const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

  const registry: SettingsRegistry<S> = {
    registerSection(section) {
      sections.set(sectionKey(section.path), section);
    },
    registerSetting(setting) {
      if (settings.has(setting.id)) throw new Error(`Setting already registered: ${setting.id}`);
      settings.set(setting.id, setting);
    },
    registerSettings(list) {
      for (const s of list) registry.registerSetting(s);
    },
    section: (path) => sections.get(sectionKey(path)),
    sectionTree() {
      const build = (parent: SectionPath): SettingsSectionNode[] =>
        [...sections.values()]
          .filter((s) => s.path.length === parent.length + 1 && isPrefix(parent, s.path))
          .sort(byOrder)
          .map((s) => ({ ...s, children: build(s.path) }));
      return build([]);
    },
    setting: (id) => settings.get(id),
    settingsIn(path, deep = false) {
      return [...settings.values()]
        .filter((s) => (deep ? isPrefix(path, s.section) : sectionKey(s.section) === sectionKey(path)))
        .sort(byOrder);
    },
    settings: () => [...settings.values()],
  };
  return registry;
}

/** The app-level Settings menu; views add their own sections (`settingsCards`). Labels are i18n keys `settings.section.<dotted path>`. */
export const DEFAULT_SECTIONS: readonly SettingsSection[] = [
  ['general', 10],
  ['appearance', 20],
  ['window', 30],
  ['editor', 40],
  ['editor.fileTypes', 10],
  ['editor.externalEditors', 20],
  ['keyboard', 80],
  ['keyboard.shortcuts', 10],
  ['system', 90],
  ['system.updates', 10],
  ['system.backup', 20],
].map(([id, order]) => ({ path: (id as string).split('.'), order: order as number, label: `settings.section.${id}` }));

export function registerDefaultSections<S>(registry: SettingsRegistry<S>): void {
  for (const s of DEFAULT_SECTIONS) registry.registerSection(s);
}

/** Shape of an option meta list such as the editor's `FORMAT_OPTION_META`. */
export interface OptionMeta<K extends string = string> {
  key: K;
  kind: 'boolean' | 'enum' | 'number' | 'string';
  values?: readonly EnumValue[];
  min?: number;
  max?: number;
}

/**
 * Builds setting entries for a flat options object (e.g. SQL formatter options) from its meta list.
 * Defaults come from `defaults`, so they live in one place. Orders follow the meta list: 10, 20, ...
 */
export function settingsFromOptionMeta<S, O extends Record<string, unknown>>(opts: {
  meta: readonly OptionMeta<Extract<keyof O, string>>[];
  defaults: O;
  /** Id prefix, e.g. `workbench.format` → `workbench.format.keywordCase`. */
  idPrefix: string;
  section: SectionPath;
  /** i18n key prefix of labels, e.g. `settings.workbench.format.` → `settings.workbench.format.keywordCase`. */
  labelPrefix: string;
  /** i18n key prefix of descriptions; omitted → no description. */
  descriptionPrefix?: string;
  get(settings: S): O;
  set(settings: S, options: O): Partial<S>;
}): SettingDef<S>[] {
  return opts.meta.map((m, i) => {
    const base = {
      id: `${opts.idPrefix}.${m.key}`,
      section: opts.section,
      order: (i + 1) * 10,
      label: `${opts.labelPrefix}${m.key}`,
      description: opts.descriptionPrefix ? `${opts.descriptionPrefix}${m.key}` : undefined,
      get: (s: S) => opts.get(s)[m.key],
      set: (s: S, v: unknown) => opts.set(s, { ...opts.get(s), [m.key]: v }),
    };
    const def = opts.defaults[m.key];
    switch (m.kind) {
      case 'boolean':
        return { ...base, kind: 'boolean', default: def as boolean } as BooleanSetting<S>;
      case 'number':
        return { ...base, kind: 'number', default: def as number, min: m.min, max: m.max } as NumberSetting<S>;
      case 'string':
        return { ...base, kind: 'string', default: def as string } as StringSetting<S>;
      case 'enum':
        return { ...base, kind: 'enum', default: def as EnumValue, values: m.values ?? [] } as EnumSetting<S>;
    }
  });
}

/** Whether a setting differs from its default (always false for `custom`, which has no getter). */
export function isModified<S>(setting: SettingDef<S>, settings: S): boolean {
  if (setting.kind === 'custom') return false;
  if (setting.modified) return setting.modified(settings);
  return setting.get(settings) !== setting.default;
}

/** The patch that resets a setting, or undefined for `custom` settings (no single set path). */
export function resetPatch<S>(setting: SettingDef<S>, settings: S): Partial<S> | undefined {
  if (setting.kind === 'custom') return undefined;
  if (setting.reset) return setting.reset(settings);
  return (setting.set as (s: S, v: unknown) => Partial<S>)(settings, setting.default);
}

/** A settings search split like VS Code's: `@modified` and `@id:<id>` filters, and the free text left over. */
export interface SettingsQuery {
  text: string;
  /** Only settings that differ from their default. */
  modified: boolean;
  /** Only these exact ids (any of them); empty means no id filter. */
  ids: string[];
}

const MODIFIED_TAG = '@modified';
const ID_TAG = '@id:';

/** Parses a settings search into its filters and free text. The filters AND with the text. */
export function parseSettingsQuery(query: string): SettingsQuery {
  let modified = false;
  const ids: string[] = [];
  const rest: string[] = [];
  for (const token of query.split(/\s+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (lower === MODIFIED_TAG) modified = true;
    else if (lower.startsWith(ID_TAG)) {
      const id = token.slice(ID_TAG.length);
      if (id && !ids.includes(id)) ids.push(id);
    } else rest.push(token);
  }
  return { text: rest.join(' '), modified, ids };
}

/** Adds `@modified` to a settings search, or removes it when present. */
export function toggleModifiedFilter(query: string): string {
  const tokens = query.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => t.toLowerCase() !== MODIFIED_TAG);
  return (kept.length === tokens.length ? [MODIFIED_TAG, ...kept] : kept).join(' ');
}

/** A description as rendered: each `#setting.id#` link becomes the target's label (or its bare id). */
export function settingDescriptionText(description: string, labelOf: (id: string) => string | undefined): string {
  return description.replace(/#([\w.-]+)#/g, (_, id: string) => labelOf(id) ?? id);
}

export type FieldDef =
  | { kind: 'boolean'; default: boolean }
  | { kind: 'string'; default: string }
  | { kind: 'number'; default: number; min: number; max: number }
  | { kind: 'enum'; default: string; values: readonly string[] };

/** A setting stored at `settings[group][key]`; id `group.key`, labels `settings.group.key` and `.hint`. */
export const groupField = <S, G extends keyof S & string>(
  group: G,
  key: string,
  order: number,
  def: FieldDef,
  section: SectionPath = [group],
): SettingDef<S> => {
  const read = (s: S) => (s[group] as Record<string, unknown> | undefined)?.[key] ?? def.default;
  const set = (s: S, v: unknown): Partial<S> => ({ [group]: { ...(s[group] as object | undefined), [key]: v } }) as unknown as Partial<S>;
  return {
    id: `${group}.${key}`,
    section,
    order,
    label: `settings.${group}.${key}`,
    description: `settings.${group}.${key}.hint`,
    ...def,
    get: read,
    set,
  } as unknown as SettingDef<S>;
};

export const bool = (default_: boolean): FieldDef => ({ kind: 'boolean', default: default_ });
export const str = (default_: string): FieldDef => ({ kind: 'string', default: default_ });
export const num = (default_: number, min: number, max: number): FieldDef => ({ kind: 'number', default: default_, min, max });
export const oneOf = (default_: string, values: readonly string[]): FieldDef => ({ kind: 'enum', default: default_, values });

/** Structural equality for JSON-like values (arrays, plain objects, primitives). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
