/** Scope of the commands that work on every screen. */
export const GLOBAL = 'global';

export interface CommandDef {
  /** Unique, `[\w.:-]{1,80}`, e.g. 'nav.explorer', 'explorer.search', 'explorer.tab.new'. */
  id: string;
  /** GLOBAL or a view id (the app's screen id). */
  scope: string;
  /** Translated text; build defs in functions called at render, like grid `defs()`. */
  label: string;
  /** Default chords in canonical form, e.g. ['Ctrl+Shift+F']. */
  keys: string[];
  /** Fires while typing; default: true when the chord has Ctrl, Alt or Meta, else false. */
  inInput?: boolean;
  /** Fires while a Modal or the palette is open; default false. */
  inModal?: boolean;
  /** Only bound in the native window (browsers keep Ctrl+T/W/Tab). */
  desktopOnly?: boolean;
}

/** User overrides by command id; [] = unbound. */
export type Keymap = Record<string, string[]>;

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

const NAMED = ['Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

const ID = /^[\w.:-]{1,80}$/;
const MAX_IDS = 300;
const MAX_CHORDS = 4;

function chord(mods: Set<Modifier>, key: string): string {
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+');
}

function keyOf(e: KeyLike): string | null {
  let m = /^Key([A-Z])$/.exec(e.code);
  if (m) return m[1];
  m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (m) return m[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) return e.key;
  if (e.code === 'Space' || e.key === ' ') return 'Space';
  if (NAMED.includes(e.key)) return e.key;
  if (e.key === 'Esc') return 'Escape';
  if (e.key.length === 1) return e.key.toUpperCase();
  return null;
}

/** The canonical chord of a key event; null for a modifier alone or an unknown key. */
export function chordOf(e: KeyLike): string | null {
  const key = keyOf(e);
  if (!key) return null;
  const mods = new Set<Modifier>();
  if (e.ctrlKey) mods.add('Ctrl');
  if (e.altKey) mods.add('Alt');
  if (e.shiftKey) mods.add('Shift');
  if (e.metaKey) mods.add('Meta');
  return chord(mods, key);
}

const MOD_ALIASES: Record<string, Modifier> = {
  ctrl: 'Ctrl', control: 'Ctrl', ctl: 'Ctrl',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
  meta: 'Meta', cmd: 'Meta', command: 'Meta',
};

const KEY_ALIASES: Record<string, string> = {
  esc: 'Escape', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', plus: '+',
  ...Object.fromEntries(NAMED.map((k) => [k.toLowerCase(), k])),
};

function normalizeKey(text: string): string | null {
  const lower = text.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  const f = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower);
  if (f) return `F${f[1]}`;
  if (text.length === 1 && text !== ' ') return text.toUpperCase();
  return null;
}

/** Canonical form of a typed chord (any case, spaces, aliases); null when it isn't one. */
export function normalizeChord(text: string): string | null {
  let body = text.replace(/\s+/g, '');
  let key: string | null = null;
  // A '+' key comes last: "+", "Ctrl++".
  if (body === '+') return '+';
  if (body.endsWith('++')) {
    key = '+';
    body = body.slice(0, -2);
  }
  if (!body) return null;
  const parts = body.split('+');
  const mods = new Set<Modifier>();
  for (const part of parts) {
    if (!part) return null;
    const mod = MOD_ALIASES[part.toLowerCase()];
    if (mod) {
      mods.add(mod);
      continue;
    }
    if (key) return null;
    key = normalizeKey(part);
    if (!key) return null;
  }
  return key ? chord(mods, key) : null;
}

/** The chords each command has: its keymap entry when there is one (even []), else its defaults. */
export function effectiveKeys(defs: CommandDef[], keymap: Keymap): Map<string, string[]> {
  return new Map(defs.map((d) => [d.id, Object.hasOwn(keymap, d.id) ? keymap[d.id] : d.keys]));
}

/** Chords bound twice in one scope, or in global and a view; each chord once, with all ids. */
export function conflictsOf(defs: CommandDef[], keymap: Keymap): Array<{ chord: string; ids: string[] }> {
  const keys = effectiveKeys(defs, keymap);
  const byChord = new Map<string, CommandDef[]>();
  for (const d of defs) {
    for (const c of new Set(keys.get(d.id))) {
      const list = byChord.get(c) ?? [];
      list.push(d);
      byChord.set(c, list);
    }
  }
  const out: Array<{ chord: string; ids: string[] }> = [];
  for (const [c, list] of byChord) {
    if (list.length < 2) continue;
    const global = list.filter((d) => d.scope === GLOBAL);
    const views = new Map<string, number>();
    for (const d of list) if (d.scope !== GLOBAL) views.set(d.scope, (views.get(d.scope) ?? 0) + 1);
    const clash = global.length > 1 || (global.length > 0 && views.size > 0) || [...views.values()].some((n) => n > 1);
    if (!clash) continue;
    // Ids of views that only collide with other views aren't part of the conflict.
    const ids = global.length > 0 ? list.map((d) => d.id) : list.filter((d) => (views.get(d.scope) ?? 0) > 1).map((d) => d.id);
    out.push({ chord: c, ids });
  }
  return out;
}

/** The commands a chord is bound to, in any scope. */
export function usesOf(chordText: string, defs: CommandDef[], keymap: Keymap): CommandDef[] {
  const keys = effectiveKeys(defs, keymap);
  return defs.filter((d) => keys.get(d.id)?.includes(chordText));
}

/** The command a chord runs in a view: the view's own first, then a global one. */
export function resolve(chordText: string, scope: string, defs: CommandDef[], keymap: Keymap, { desktop = true }: { desktop?: boolean } = {}): CommandDef | null {
  const keys = effectiveKeys(defs, keymap);
  const bound = defs.filter((d) => (desktop || !d.desktopOnly) && keys.get(d.id)?.includes(chordText));
  return bound.find((d) => d.scope === scope && scope !== GLOBAL) ?? bound.find((d) => d.scope === GLOBAL) ?? null;
}

/** Whether a def fires while typing in a field: its `inInput`, else when its chord has Ctrl, Alt or Meta. */
export function firesInInput(def: CommandDef, chordText: string): boolean {
  return def.inInput ?? /(^|\+)(Ctrl|Alt|Meta)\+/.test(chordText);
}

/** A keymap read back from settings, canonicalized; null when anything in it is off. */
export function validKeymap(raw: unknown): Keymap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > MAX_IDS) return null;
  const out: Keymap = {};
  for (const [id, chords] of entries) {
    if (!ID.test(id) || !Array.isArray(chords) || chords.length > MAX_CHORDS) return null;
    const list: string[] = [];
    for (const c of chords) {
      const n = typeof c === 'string' && c.length <= 60 ? normalizeChord(c) : null;
      if (!n) return null;
      list.push(n);
    }
    out[id] = list;
  }
  return out;
}

/** A container attribute: `data-keys="own"` keeps keys pressed inside it from app commands. */
export const OWN_KEYS_ATTR = 'data-keys';
/** Space-separated command ids that still fire inside a `data-keys="own"` container. */
export const ALLOW_KEYS_ATTR = 'data-keys-allow';

interface Closest {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/** Whether a key event's target sits in a `data-keys="own"` container that doesn't allow command `id`. */
export function ownsKey(target: unknown, id: string): boolean {
  if (!target || typeof (target as Closest).closest !== 'function') return false;
  const owner = (target as Closest).closest(`[${OWN_KEYS_ATTR}="own"]`);
  if (!owner) return false;
  return !(owner.getAttribute(ALLOW_KEYS_ATTR) ?? '').split(/\s+/).includes(id);
}
