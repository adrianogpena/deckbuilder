import { describe, expect, test } from 'bun:test';
import { addSnippet, addTodo, clearDone, clockText, editTodo, emptyDaily, parseDaily, removeTodo, setScratch, toggleTodo } from './model';

describe('daily model', () => {
  test('parseDaily cleans input', () => {
    expect(parseDaily(null)).toEqual(emptyDaily());
    const d = parseDaily({
      todos: [{ id: 'a', text: ' x ', done: true }, { id: '', text: 'no id' }, { id: 'b', text: '  ' }, 3],
      scratch: 5,
      snippets: [{ id: 's', label: 'L', text: 'T' }, { id: 't', label: '', text: 'T' }],
    });
    expect(d).toEqual({ todos: [{ id: 'a', text: 'x', done: true }], scratch: '', snippets: [{ id: 's', label: 'L', text: 'T' }] });
  });

  test('todo edits', () => {
    let d = addTodo(emptyDaily(), 'a', '  one ');
    d = addTodo(d, 'b', 'two');
    expect(addTodo(d, 'c', '   ')).toBe(d);
    d = toggleTodo(d, 'a');
    expect(d.todos[0]!.done).toBe(true);
    expect(toggleTodo(d, 'zz')).toBe(d);
    expect(editTodo(d, 'b', 'deux').todos[1]!.text).toBe('deux');
    expect(editTodo(d, 'b', ' ')).toBe(d);
    expect(clearDone(d).todos.map((t) => t.id)).toEqual(['b']);
    expect(removeTodo(d, 'a').todos.map((t) => t.id)).toEqual(['b']);
  });

  test('scratch and snippets', () => {
    expect(setScratch(emptyDaily(), 'x'.repeat(30000)).scratch).toHaveLength(20000);
    expect(addSnippet(emptyDaily(), 'a', 'Sig', 'Best').snippets).toHaveLength(1);
    expect(addSnippet(emptyDaily(), 'a', '', 'Best').snippets).toHaveLength(0);
  });

  test('clockText', () => {
    expect(clockText(25 * 60_000)).toBe('25:00');
    expect(clockText(61_001)).toBe('01:02');
    expect(clockText(-5)).toBe('00:00');
  });
});
