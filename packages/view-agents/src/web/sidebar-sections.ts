/** Sidebar section cards (spec S5): collapsed, hidden and order state, kept in localStorage. */
export type SectionId = 'sessions' | 'tags' | 'archived' | 'usage';

export const SECTION_IDS: readonly SectionId[] = ['sessions', 'tags', 'archived', 'usage'];

export const SECTIONS_KEY = 'deckbuilder.agents.sections';

export interface SectionsState {
  /** Explicit order once the user reordered; undefined = default order. */
  order?: SectionId[];
  collapsed: SectionId[];
  hidden: SectionId[];
}

export const DEFAULT_SECTIONS: SectionsState = { collapsed: ['archived'], hidden: [] };

const isId = (x: unknown): x is SectionId => typeof x === 'string' && (SECTION_IDS as readonly string[]).includes(x);
const ids = (x: unknown): SectionId[] => (Array.isArray(x) ? [...new Set(x.filter(isId))] : []);

/** A valid state from stored JSON: unknown ids dropped, missing order ids appended. */
export function normalizeSections(raw: unknown): SectionsState {
  if (!raw || typeof raw !== 'object') return DEFAULT_SECTIONS;
  const r = raw as Record<string, unknown>;
  const order = r.order === undefined ? undefined : ids(r.order);
  return {
    ...(order ? { order: [...order, ...SECTION_IDS.filter((id) => !order.includes(id))] } : {}),
    collapsed: 'collapsed' in r ? ids(r.collapsed) : DEFAULT_SECTIONS.collapsed,
    hidden: ids(r.hidden),
  };
}

/** The display order: the stored one, else the default with Usage first when its setting says top. */
export function sectionOrder(s: SectionsState, usageTop = false): SectionId[] {
  if (s.order) return s.order;
  return usageTop ? ['usage', 'sessions', 'tags', 'archived'] : [...SECTION_IDS];
}

const toggle = (list: SectionId[], id: SectionId, on: boolean) => (on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id));

export function toggleSection(s: SectionsState, id: SectionId): SectionsState {
  return { ...s, collapsed: toggle(s.collapsed, id, !s.collapsed.includes(id)) };
}

export function hideSection(s: SectionsState, id: SectionId): SectionsState {
  return { ...s, hidden: toggle(s.hidden, id, true) };
}

export function restoreSection(s: SectionsState, id: SectionId): SectionsState {
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
