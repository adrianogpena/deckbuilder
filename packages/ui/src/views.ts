import { type ComponentType, createContext, createElement, type ReactNode, Suspense, useContext, useMemo, useSyncExternalStore } from 'react';
import { tryT } from './i18n';
import type { IconName } from './icons';
import type { CommandDef } from './keybindings';
import type { SettingDef, SettingsRegistry, SettingsSection } from './settings-schema';

export interface ViewProps<S> {
  settings: S;
  onSave(patch: Partial<S>): void;
  go(id: string): void;
  options?: unknown;
}

/** What the Settings screen gives a view's settings card. */
export interface SettingsCardProps<S> {
  settings: S;
  onChange(patch: Partial<S>): void;
  /** One schema setting as a row (its hand-written field when the view has one); nothing when the app has not registered it. */
  row(id: string): ReactNode;
  /** Schema settings as one card of rows. */
  rows(ids: readonly string[]): ReactNode;
}

/** The hand-written row of a schema setting. */
export interface SettingsFieldProps<S> {
  def: SettingDef<S>;
  settings: S;
  onChange(patch: Partial<S>): void;
}

/** What a view adds to Settings: its nav sections, the page of each, and hand-written rows. */
export interface ViewSettingsCards<S> {
  /** Nav entries (label key `settings.section.<path>`); the app lists them with its own sections, ordered by `order`. */
  sections: SettingsSection[];
  /** Page of a section by its dotted key; a section without one shows its schema rows. */
  cards?: Record<string, ComponentType<SettingsCardProps<S>>>;
  /** Row of a schema setting by id, for custom settings and rows that need more than a plain control. */
  fields?: Record<string, ComponentType<SettingsFieldProps<S>>>;
}

export interface ViewDef<Id extends string, S, K extends string = string> {
  id: Id;
  nav: {
    /** i18n key of the nav section title. */
    group: string;
    icon: IconName;
    label: K;
    order: number;
  };
  render(p: ViewProps<S>): ReactNode;
  provider?: ComponentType<{ settings: S; children: ReactNode }>;
  /** Screen-scoped commands. */
  commands?(): CommandDef[];
  /** App-wide keys. */
  keybindings?(): CommandDef[];
  settings?: { defs: SettingDef<S>[] };
  settingsCards?: ViewSettingsCards<S>;
  messages: { en: Record<K, string> & Record<string, string>; 'pt-BR': Record<string, string> };
}

/** Identity; keeps the literal `Id` of the view. */
export function defineView<const Id extends string, S, K extends string = string>(def: ViewDef<Id, S, K>): ViewDef<Id, S, K> {
  return def;
}

/** The link intents of one `createViews`: a pending payload per view, taken once by the receiving view. */
export interface ViewLinks {
  has(id: string): boolean;
  /** Stores `payload` for view `id` and navigates there; nothing for an unknown view. */
  link(id: string, payload?: unknown): void;
  peek(id: string): unknown;
  /** Removes and returns the pending payload of `id`. */
  take(id: string): unknown;
  subscribe(listener: () => void): () => void;
}

const noLinks: ViewLinks = { has: () => false, link() {}, peek: () => undefined, take: () => undefined, subscribe: () => () => {} };
const ViewLinksContext = createContext<ViewLinks>(noLinks);

/**
 * A function that sends `payload` to view `id` and shows it, or `null` when the app has no such view
 * (hide the action then). The view reads it with `useViewRequest`.
 */
export function useViewLink<T = void>(id: string): ((payload: T) => void) | null {
  const links = useContext(ViewLinksContext);
  const present = links.has(id);
  return useMemo(() => (present ? (payload: T) => links.link(id, payload) : null), [links, id, present]);
}

/**
 * The payload another view sent to `id` with `useViewLink`, until `take()` removes it (call it once handled).
 * Re-renders when a new one arrives; a payload sent before the view mounted is still there.
 */
export function useViewRequest<T>(id: string): { request: T | undefined; take(): T | undefined } {
  const links = useContext(ViewLinksContext);
  const peek = () => links.peek(id);
  const request = useSyncExternalStore(links.subscribe, peek, peek) as T | undefined;
  return { request, take: () => links.take(id) as T | undefined };
}

type AnyView = ViewDef<string, any, string>;
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type SliceOf<D> = D extends ViewDef<string, infer X, string> ? X : never;

export interface NavGroup<Id extends string = string> {
  group: string;
  items: Array<{ id: Id; label: string; icon: IconName }>;
}

export interface CreateViewsOptions {
  options?: Record<string, unknown>;
  fallback?: ReactNode;
}

export function createViews<const Defs extends readonly AnyView[]>(defs: Defs, opts: CreateViewsOptions = {}) {
  type Id = Defs[number]['id'];
  /** The settings every view reads: the intersection of the view slices. */
  type S = UnionToIntersection<SliceOf<Defs[number]>>;
  const byId = new Map<string, AnyView>();
  for (const d of defs) {
    if (byId.has(d.id)) throw new Error(`View already registered: ${d.id}`);
    byId.set(d.id, d);
  }

  const messages: { en: Record<string, string>; 'pt-BR': Record<string, string> } = { en: {}, 'pt-BR': {} };
  for (const d of defs) {
    for (const lang of ['en', 'pt-BR'] as const) {
      for (const [key, text] of Object.entries(d.messages[lang])) {
        if (Object.hasOwn(messages[lang], key)) throw new Error(`Duplicate message key (${lang}): ${key}`);
        messages[lang][key] = text;
      }
    }
  }

  const groups: NavGroup<Id>[] = [];
  for (const d of [...defs].sort((a, b) => a.nav.order - b.nav.order)) {
    let g = groups.find((x) => x.group === d.nav.group);
    if (!g) groups.push((g = { group: d.nav.group, items: [] }));
    g.items.push({ id: d.id as Id, label: d.nav.label, icon: d.nav.icon });
  }

  const pending = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  let navigate: ((id: string) => void) | undefined;
  const links: ViewLinks = {
    has: (id) => byId.has(id),
    link(id, payload) {
      if (!byId.has(id)) return;
      pending.set(id, payload);
      emit();
      navigate?.(id);
    },
    peek: (id) => pending.get(id),
    take(id) {
      const payload = pending.get(id);
      if (pending.delete(id)) emit();
      return payload;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };

  const providers = defs.filter((d) => d.provider);
  /** `go` is how a view link navigates (`views.link`, `useViewLink`). */
  const Providers: ComponentType<{ settings: S; go?: (id: string) => void; children: ReactNode }> = ({ settings, go, children }) => {
    if (go) navigate = go;
    return createElement(
      ViewLinksContext.Provider,
      { value: links },
      providers.reduceRight<ReactNode>((inner, d) => createElement(d.provider!, { settings, children: inner }), children),
    );
  };

  return {
    ids: defs.map((d) => d.id) as readonly Id[],
    nav: groups,
    has: (id: string): id is Id => byId.has(id),
    /** Sends `payload` to view `id` (read there with `useViewRequest`) and navigates to it. */
    link: links.link,
    /** Translated nav label; the id itself for an unknown view. */
    label(id: string): string {
      const d = byId.get(id);
      return d ? (tryT(d.nav.label) ?? d.nav.label) : id;
    },
    render(id: string, props: ViewProps<S>): ReactNode {
      const d = byId.get(id);
      if (!d) return null;
      return createElement(Suspense, { fallback: opts.fallback ?? null }, d.render({ options: opts.options, ...props }));
    },
    Providers,
    commands: (): CommandDef[] => defs.flatMap((d) => d.commands?.() ?? []),
    keybindings: (): CommandDef[] => defs.flatMap((d) => d.keybindings?.() ?? []),
    /** The views' sections and settings go into the app's registry. */
    registerSettings(registry: SettingsRegistry<S>): void {
      for (const d of defs) {
        for (const section of d.settingsCards?.sections ?? []) registry.registerSection(section);
        if (d.settings) registry.registerSettings(d.settings.defs);
      }
    },
    /** The Settings pages and hand-written rows the views add, by section key and setting id. */
    settingsCards: {
      cards: Object.assign({}, ...defs.map((d) => d.settingsCards?.cards)) as Record<string, ComponentType<SettingsCardProps<S>>>,
      fields: Object.assign({}, ...defs.map((d) => d.settingsCards?.fields)) as Record<string, ComponentType<SettingsFieldProps<S>>>,
    },
    messages,
  };
}

export type ViewIds<V extends { ids: readonly string[] }> = V['ids'][number];

/** `{ key: default }` of the settings `<prefix>.<key>` (e.g. prefix `terminal`). */
export function settingDefaultsOf(defs: readonly SettingDef<any>[], prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) if (d.id.startsWith(`${prefix}.`)) out[d.id.slice(prefix.length + 1)] = d.default;
  return out;
}
