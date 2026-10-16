import { describe, expect, test } from 'bun:test';
import { GLOBAL, chordOf, conflictsOf, effectiveKeys, firesInInput, normalizeChord, ownsKey, resolve, startsOf, validKeymap, type CommandDef, type KeyLike } from '../src/keybindings.ts';

const ev = (key: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
const def = (id: string, scope: string, keys: string[], extra: Partial<CommandDef> = {}): CommandDef => ({ id, scope, label: id, keys, ...extra });

describe('chordOf', () => {
  test('letters come from the code, upper case, with modifiers in order', () => {
    expect(chordOf(ev('k', 'KeyK', { ctrlKey: true }))).toBe('Ctrl+K');
    expect(chordOf(ev('F', 'KeyF', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+F');
    expect(chordOf(ev('ç', 'KeyC', { metaKey: true, altKey: true, ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Alt+Shift+Meta+C');
  });

  test('Shift+digit stays a digit; Numpad digits too', () => {
    expect(chordOf(ev('!', 'Digit1', { shiftKey: true }))).toBe('Shift+1');
    expect(chordOf(ev('2', 'Digit2', { altKey: true }))).toBe('Alt+2');
    expect(chordOf(ev('7', 'Numpad7'))).toBe('7');
  });

  test('F-keys, named keys and punctuation', () => {
    expect(chordOf(ev('F5', 'F5'))).toBe('F5');
    expect(chordOf(ev('F24', 'F24', { ctrlKey: true }))).toBe('Ctrl+F24');
    expect(chordOf(ev('Tab', 'Tab', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Tab');
    expect(chordOf(ev(' ', 'Space', { ctrlKey: true }))).toBe('Ctrl+Space');
    expect(chordOf(ev('ArrowUp', 'ArrowUp', { altKey: true }))).toBe('Alt+ArrowUp');
    expect(chordOf(ev('/', 'Slash', { ctrlKey: true }))).toBe('Ctrl+/');
  });

  test('modifier alone, dead and unidentified keys give null', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta']) expect(chordOf(ev(key, `${key}Left`, { ctrlKey: key === 'Control' }))).toBeNull();
    expect(chordOf(ev('Dead', 'Quote'))).toBeNull();
    expect(chordOf(ev('Unidentified', ''))).toBeNull();
  });
});

describe('normalizeChord', () => {
  test('any case and spacing, modifiers reordered', () => {
    expect(normalizeChord('ctrl + shift + f')).toBe('Ctrl+Shift+F');
    expect(normalizeChord('Shift+Ctrl+f')).toBe('Ctrl+Shift+F');
    expect(normalizeChord('alt+1')).toBe('Alt+1');
    expect(normalizeChord('f12')).toBe('F12');
  });

  test('aliases', () => {
    expect(normalizeChord('Control+K')).toBe('Ctrl+K');
    expect(normalizeChord('Ctl+K')).toBe('Ctrl+K');
    expect(normalizeChord('Cmd+K')).toBe('Meta+K');
    expect(normalizeChord('Command+K')).toBe('Meta+K');
    expect(normalizeChord('Option+K')).toBe('Alt+K');
    expect(normalizeChord('esc')).toBe('Escape');
    expect(normalizeChord('Ctrl+Del')).toBe('Ctrl+Delete');
    expect(normalizeChord('Alt+up')).toBe('Alt+ArrowUp');
    expect(normalizeChord('ctrl+pagedown')).toBe('Ctrl+PageDown');
    expect(normalizeChord('Ctrl+Plus')).toBe('Ctrl++');
    expect(normalizeChord('Ctrl++')).toBe('Ctrl++');
  });

  test('rejects no key, two keys and unknown names', () => {
    for (const bad of ['', 'Ctrl', 'Ctrl+Shift', 'Ctrl+', 'Ctrl+A+B', 'Ctrl+Foo', 'F25', 'Hyper+K', 'A++']) expect(normalizeChord(bad)).toBeNull();
  });
});

describe('sequences', () => {
  test('normalizeChord canonicalizes each step', () => {
    expect(normalizeChord('ctrl+k  ctrl + c')).toBe('Ctrl+K Ctrl+C');
    expect(normalizeChord('Ctrl+K c')).toBe('Ctrl+K C');
    expect(normalizeChord('g g')).toBe('G G');
  });

  test('normalizeChord rejects bad steps and more than three', () => {
    expect(normalizeChord('Ctrl+K Foo')).toBeNull();
    expect(normalizeChord('A B C D')).toBeNull();
  });

  test('conflictsOf reports a binding that starts a longer one', () => {
    const defs = [def('a', GLOBAL, ['Ctrl+K']), def('b', 'v', ['Ctrl+K Ctrl+C']), def('c', 'w', ['Ctrl+K Ctrl+D'])];
    expect(conflictsOf(defs, {})).toEqual([{ chord: 'Ctrl+K', ids: ['a', 'b', 'c'] }]);
    expect(conflictsOf([def('b', 'v', ['Ctrl+K Ctrl+C']), def('c', 'w', ['Ctrl+K'])], {})).toEqual([]);
  });

  test('resolve matches the whole sequence, startsOf the longer ones', () => {
    const defs = [def('g', GLOBAL, ['Ctrl+K Ctrl+C']), def('v', 'v', ['Ctrl+K Ctrl+C', 'G G'])];
    expect(resolve('Ctrl+K Ctrl+C', 'v', defs, {})?.id).toBe('v');
    expect(resolve('Ctrl+K', 'v', defs, {})).toBeNull();
    expect(startsOf('Ctrl+K', 'v', defs, {}).map((d) => d.id)).toEqual(['g', 'v']);
    expect(startsOf('Ctrl+K', 'other', defs, {}).map((d) => d.id)).toEqual(['g']);
    expect(startsOf('Ctrl+K Ctrl+C', 'v', defs, {})).toEqual([]);
  });

  test('a sequence fires in inputs by its first step', () => {
    expect(firesInInput(def('a', GLOBAL, []), 'Ctrl+K C')).toBe(true);
    expect(firesInInput(def('a', GLOBAL, []), 'G Ctrl+K')).toBe(false);
  });

  test('validKeymap keeps sequences', () => {
    expect(validKeymap({ a: ['ctrl+k ctrl+c'] })).toEqual({ a: ['Ctrl+K Ctrl+C'] });
  });
});

describe('effectiveKeys', () => {
  test('an override replaces the defaults, [] unbinds, unknown ids are ignored', () => {
    const defs = [def('a', GLOBAL, ['Ctrl+A']), def('b', GLOBAL, ['Ctrl+B']), def('c', GLOBAL, ['Ctrl+C'])];
    const keys = effectiveKeys(defs, { a: ['Ctrl+X'], b: [], zzz: ['Ctrl+Z'] });
    expect([...keys]).toEqual([['a', ['Ctrl+X']], ['b', []], ['c', ['Ctrl+C']]]);
  });
});

describe('conflictsOf', () => {
  test('same chord twice in one scope', () => {
    const defs = [def('a', 'v', ['Ctrl+A']), def('b', 'v', ['Ctrl+B'])];
    expect(conflictsOf(defs, { b: ['Ctrl+A'] })).toEqual([{ chord: 'Ctrl+A', ids: ['a', 'b'] }]);
  });

  test('global and a view, reported once with all ids', () => {
    const defs = [def('g', GLOBAL, ['Ctrl+K']), def('v1', 'one', ['Ctrl+K']), def('v2', 'two', ['Ctrl+K'])];
    expect(conflictsOf(defs, {})).toEqual([{ chord: 'Ctrl+K', ids: ['g', 'v1', 'v2'] }]);
  });

  test('the same chord in two views is fine', () => {
    const defs = [def('v1', 'one', ['Ctrl+T']), def('v2', 'two', ['Ctrl+T'])];
    expect(conflictsOf(defs, {})).toEqual([]);
  });

  test('an unbound command no longer conflicts', () => {
    const defs = [def('g', GLOBAL, ['Ctrl+K']), def('v', 'one', ['Ctrl+K'])];
    expect(conflictsOf(defs, { v: [] })).toEqual([]);
  });
});

describe('resolve', () => {
  const defs = [
    def('g.k', GLOBAL, ['Ctrl+K']),
    def('g.t', GLOBAL, ['Ctrl+T']),
    def('v.t', 'v', ['Ctrl+T'], { desktopOnly: true }),
    def('w.x', 'w', ['Ctrl+X']),
  ];

  test('view first, then global', () => {
    expect(resolve('Ctrl+T', 'v', defs, {})?.id).toBe('v.t');
    expect(resolve('Ctrl+K', 'v', defs, {})?.id).toBe('g.k');
    expect(resolve('Ctrl+T', 'w', defs, {})?.id).toBe('g.t');
    expect(resolve('Ctrl+X', 'v', defs, {})).toBeNull();
    expect(resolve('Ctrl+Q', 'v', defs, {})).toBeNull();
  });

  test('desktopOnly defs are skipped outside the native window', () => {
    expect(resolve('Ctrl+T', 'v', defs, {}, { desktop: false })?.id).toBe('g.t');
  });

  test('uses the keymap', () => {
    expect(resolve('Ctrl+Q', 'v', defs, { 'g.k': ['Ctrl+Q'] })?.id).toBe('g.k');
    expect(resolve('Ctrl+K', 'v', defs, { 'g.k': ['Ctrl+Q'] })).toBeNull();
  });
});

describe('validKeymap', () => {
  test('canonicalizes chords', () => {
    expect(validKeymap({ 'nav.explorer': ['ctrl + e'], 'tabs.tab.new': [] })).toEqual({ 'nav.explorer': ['Ctrl+E'], 'tabs.tab.new': [] });
  });

  test('rejects bad shapes, ids, chords and sizes', () => {
    expect(validKeymap(null)).toBeNull();
    expect(validKeymap([])).toBeNull();
    expect(validKeymap({ a: 'Ctrl+A' })).toBeNull();
    expect(validKeymap({ 'bad id': ['Ctrl+A'] })).toBeNull();
    expect(validKeymap({ ['x'.repeat(81)]: ['Ctrl+A'] })).toBeNull();
    expect(validKeymap({ a: ['Ctrl+Foo'] })).toBeNull();
    expect(validKeymap({ a: [1] })).toBeNull();
    expect(validKeymap({ a: ['A', 'B', 'C', 'D', 'E'] })).toBeNull();
    expect(validKeymap(Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`c${i}`, []])))).toBeNull();
    expect(validKeymap(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`c${i}`, []])))).not.toBeNull();
  });
});

describe('ownsKey', () => {
  const inside = (attrs: Record<string, string> | null) => ({
    closest: (sel: string) => (attrs && sel === '[data-keys="own"]' ? { getAttribute: (n: string) => attrs[n] ?? null } : null),
  });

  test('skips commands from inside a data-keys="own" container', () => {
    expect(ownsKey(inside({ 'data-keys': 'own' }), 'nav.explorer')).toBe(true);
  });

  test('lets allowlisted commands through', () => {
    const t = inside({ 'data-keys': 'own', 'data-keys-allow': 'palette.toggle  app.quit' });
    expect(ownsKey(t, 'palette.toggle')).toBe(false);
    expect(ownsKey(t, 'app.quit')).toBe(false);
    expect(ownsKey(t, 'tabs.close')).toBe(true);
  });

  test('ignores targets outside a container or without closest', () => {
    expect(ownsKey(inside(null), 'nav.explorer')).toBe(false);
    expect(ownsKey(null, 'nav.explorer')).toBe(false);
    expect(ownsKey({ addEventListener() {} }, 'nav.explorer')).toBe(false);
  });
});

describe('gallery default keymap', () => {
  test('has no conflicts or prefix clashes', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    Object.assign(globalThis, {
      window: { location: { href: 'http://localhost/', search: '', hash: '' }, history: { replaceState() {} }, sessionStorage: storage, localStorage: storage, matchMedia: () => ({ matches: false }) },
      localStorage: storage, sessionStorage: storage,
    });
    const { commands } = await import('../../../apps/gallery/web/src/commands.ts');
    const { views } = await import('../../../apps/gallery/web/src/views.ts');
    expect(conflictsOf(commands(views), {})).toEqual([]);
  });
});
