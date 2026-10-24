import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { createJsonStore } from '../../json-store';
import { addSnippet, addTodo, clearDone, editTodo, emptyDaily, parseDaily, removeSnippet, removeTodo, setScratch, toggleTodo, type Daily } from './model';

const stores = new Map<string, ReturnType<typeof createJsonStore<Daily>>>();

const storeOf = (dataDir: string) => {
  let s = stores.get(dataDir);
  if (!s) {
    s = createJsonStore<Daily>({ dataDir, name: 'daily', parse: parseDaily, empty: emptyDaily });
    stores.set(dataDir, s);
  }
  return s;
};

const field = (payload: unknown, key: string): string => {
  const v = ((payload ?? {}) as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
};

const edit = (dataDir: string, fn: (d: Daily) => Daily) => storeOf(dataDir).update(fn);

const dailySource = (id: string, actions: DataSource['actions']): DataSource =>
  defineSource({ id, fields: [], fetch: (_config, ctx) => storeOf(ctx.dataDir).read(), actions });

export const todoSource = dailySource('todo', {
  add: (p, _c, ctx) => edit(ctx.dataDir, (d) => addTodo(d, crypto.randomUUID(), field(p, 'text'))),
  toggle: (p, _c, ctx) => edit(ctx.dataDir, (d) => toggleTodo(d, field(p, 'id'))),
  edit: (p, _c, ctx) => edit(ctx.dataDir, (d) => editTodo(d, field(p, 'id'), field(p, 'text'))),
  remove: (p, _c, ctx) => edit(ctx.dataDir, (d) => removeTodo(d, field(p, 'id'))),
  'clear-done': (_p, _c, ctx) => edit(ctx.dataDir, clearDone),
});

export const scratchpadSource = dailySource('scratchpad', {
  save: (p, _c, ctx) => edit(ctx.dataDir, (d) => setScratch(d, field(p, 'text'))),
});

export const snippetsSource = dailySource('snippets', {
  add: (p, _c, ctx) => edit(ctx.dataDir, (d) => addSnippet(d, crypto.randomUUID(), field(p, 'label'), field(p, 'text'))),
  remove: (p, _c, ctx) => edit(ctx.dataDir, (d) => removeSnippet(d, field(p, 'id'))),
});

export const specs: GridPanelSpec[] = [
  { kind: 'todo', fields: [], allowMultiple: false },
  { kind: 'scratchpad', fields: [], allowMultiple: false },
  { kind: 'snippets', fields: [], allowMultiple: false },
  { kind: 'focus-timer', fields: [], allowMultiple: false },
];

export const sources: DataSource<any>[] = [todoSource, scratchpadSource, snippetsSource];
