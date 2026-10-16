import { type ComponentType, createElement, type ReactNode, Suspense } from 'react';
import { tryT } from './i18n';
import type { IconName } from './icons';
import type { CommandDef } from './keybindings';
import type { SettingDef, SettingsRegistry } from './settings-schema';

export interface ViewProps<S> {
  settings: S;
  onSave(patch: Partial<S>): void;
  go(id: string): void;
  options?: unknown;
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
  messages: { en: Record<K, string> & Record<string, string>; 'pt-BR': Record<string, string> };
}

/** Identity; keeps the literal `Id` of the view. */
export function defineView<const Id extends string, S, K extends string = string>(def: ViewDef<Id, S, K>): ViewDef<Id, S, K> {
  return def;
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

  const providers = defs.filter((d) => d.provider);
  const Providers: ComponentType<{ settings: S; children: ReactNode }> = ({ settings, children }) =>
    providers.reduceRight<ReactNode>((inner, d) => createElement(d.provider!, { settings, children: inner }), children);

  return {
    ids: defs.map((d) => d.id) as readonly Id[],
    nav: groups,
    has: (id: string): id is Id => byId.has(id),
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
    registerSettings(registry: SettingsRegistry<S>): void {
      for (const d of defs) if (d.settings) registry.registerSettings(d.settings.defs);
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
