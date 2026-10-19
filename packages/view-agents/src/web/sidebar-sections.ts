import { PANEL_KINDS } from './workspace/types';

/** Sidebar section cards (spec S5, A3): collapsed, hidden and order state, kept in localStorage. */
export type CoreSectionId = 'sessions' | 'changes' | 'files' | 'tags' | 'archived' | 'usage';
/** A core card, or a docked tool panel (`tool:<kind>`). */
export type SectionId = CoreSectionId | `tool:${string}`;

export const CORE_IDS: readonly CoreSectionId[] = ['sessions', 'changes', 'files', 'tags', 'archived', 'usage'];
export const SECTION_IDS = CORE_IDS;

export const SECTIONS_KEY = 'deckbuilder.agents.sections';
/** Fired on `window` when another part of the screen changed the stored state (a tab moved to the sidebar). */
export const SECTIONS_EVENT = 'deckbuilder-agents-sections';

export interface SectionsState {
  /** Explicit order once the user reordered; undefined = default order. */
  order?: SectionId[];
  collapsed: SectionId[];
  hidden: SectionId[];
  /** Kinds of the tool panels docked as cards (not the ones that have a core card). */
  tools: string[];
}

export const DEFAULT_SECTIONS: SectionsState = { collapsed: ['archived'], hidden: [], tools: [] };

/** Tool kinds that are core cards instead of `tool:` cards. */
const CORE_OF_KIND: Record<string, CoreSectionId> = { changes: 'changes', files: 'files', usage: 'usage' };

/** The card a tool kind docks as. */
export const sectionOfKind = (kind: string): SectionId => CORE_OF_KIND[kind] ?? `tool:${kind}`;

/** The tool kind of a `tool:` card, else undefined. */
export const toolKind = (id: SectionId): string | undefined => (id.startsWith('tool:') ? id.slice(5) : undefined);

const isKind = (k: string) => (PANEL_KINDS as readonly string[]).includes(k) && !(k in CORE_OF_KIND);
const isCore = (x: unknown): x is CoreSectionId => typeof x === 'string' && (CORE_IDS as readonly string[]).includes(x);
const isId = (x: unknown): x is SectionId => isCore(x) || (typeof x === 'string' && x.startsWith('tool:') && isKind(x.slice(5)));
const ids = (x: unknown): SectionId[] => (Array.isArray(x) ? [...new Set(x.filter(isId))] : []);

/** A valid state from stored JSON: unknown ids dropped, missing order ids appended. */
export function normalizeSections(raw: unknown): SectionsState {
  if (!raw || typeof raw !== 'object') return DEFAULT_SECTIONS;
  const r = raw as Record<string, unknown>;
  const tools = Array.isArray(r.tools) ? [...new Set(r.tools.filter((k): k is string => typeof k === 'string' && isKind(k)))] : [];
  const live = (id: SectionId) => !toolKind(id) || tools.includes(toolKind(id)!);
  const order = r.order === undefined ? undefined : ids(r.order).filter(live);
  return {
    ...(order ? { order: [...order, ...CORE_IDS.filter((id) => !order.includes(id))] } : {}),
    collapsed: 'collapsed' in r ? ids(r.collapsed) : DEFAULT_SECTIONS.collapsed,
    hidden: ids(r.hidden).filter(isCore),
    tools,
  };
}

/** The display order: the stored one, else the default with Usage first when its setting says top; docked tools last unless ordered. */
export function sectionOrder(s: SectionsState, usageTop = false): SectionId[] {
  const base: SectionId[] = s.order ? [...s.order] : usageTop ? ['usage', ...CORE_IDS.filter((id) => id !== 'usage')] : [...CORE_IDS];
  const docked = s.tools.map((k): SectionId => `tool:${k}`);
  return [...base.filter((id) => !toolKind(id) || docked.includes(id)), ...docked.filter((id) => !base.includes(id))];
}

const toggle = (list: SectionId[], id: SectionId, on: boolean) => (on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id));

export function toggleSection(s: SectionsState, id: SectionId): SectionsState {
  return { ...s, collapsed: toggle(s.collapsed, id, !s.collapsed.includes(id)) };
}

/** Docks a tool panel as a card (a kind with a core card shows that card instead). */
export function dockTool(s: SectionsState, kind: string): SectionsState {
  const id = sectionOfKind(kind);
  if (toolKind(id) === undefined) return restoreSection(s, id);
  return s.tools.includes(kind) ? s : { ...s, tools: [...s.tools, kind] };
}

export function undockTool(s: SectionsState, kind: string): SectionsState {
  const id = sectionOfKind(kind);
  if (toolKind(id) === undefined) return hideSection(s, id);
  return { ...s, tools: s.tools.filter((k) => k !== kind), ...(s.order ? { order: s.order.filter((x) => x !== id) } : {}) };
}

/** × on a card: a core card is hidden, a tool card is undocked. */
export function hideSection(s: SectionsState, id: SectionId): SectionsState {
  const kind = toolKind(id);
  if (kind !== undefined) return undockTool(s, kind);
  return { ...s, hidden: toggle(s.hidden, id, true) };
}

export function restoreSection(s: SectionsState, id: SectionId): SectionsState {
  const kind = toolKind(id);
  if (kind !== undefined) return dockTool(s, kind);
  return { ...s, hidden: toggle(s.hidden, id, false) };
}

export function restoreAll(s: SectionsState): SectionsState {
  return { ...s, hidden: [] };
}

/** Moves `id` to index `to` of the display order (clamped); the result has an explicit order. */
export function moveSection(s: SectionsState, id: SectionId, to: number, usageTop = false): SectionsState {
  const order = sectionOrder(s, usageTop).filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(to, order.length)), 0, id);
  return { ...s, order };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

export function loadSections(storage: Store | undefined = store()): SectionsState {
  try {
    const raw = storage?.getItem(SECTIONS_KEY);
    return raw ? normalizeSections(JSON.parse(raw)) : DEFAULT_SECTIONS;
  } catch {
    return DEFAULT_SECTIONS;
  }
}

export function saveSections(s: SectionsState, storage: Store | undefined = store()): void {
  try {
    storage?.setItem(SECTIONS_KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked: the state lives for this session only.
  }
}

/** Docks (`on`) or undocks a tool kind from outside the sidebar: saves the state and tells a mounted sidebar to reload. */
export function setDocked(kind: string, on: boolean): void {
  const next = (on ? dockTool : undockTool)(loadSections(), kind);
  saveSections(next);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SECTIONS_EVENT));
}

/** Tool kinds that can be docked as sidebar cards (`placement` sidebar or both). */
export const isDockable = (m: { placement: string }): boolean => m.placement !== 'center';
