import { describe, expect, test } from 'bun:test';
import { conflictsOf } from '@deckbuilder/ui/keybindings';

// The ui index reads `window` at import time.
Object.assign(globalThis, { window: { location: { href: 'http://127.0.0.1/' } } });
const { commandById, commands, navCommandId } = await import('./commands');
const { views } = await import('./views');

describe('gallery commands', () => {
  test('ids are unique', () => {
    const ids = commands(views).map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('default chords do not conflict', () => {
    expect(conflictsOf(commands(views), {})).toEqual([]);
  });

  test('every nav screen has a command', () => {
    for (const item of views.nav.flatMap((s) => s.items)) expect(commandById(navCommandId(item.id)).keys).toHaveLength(1);
  });
});
