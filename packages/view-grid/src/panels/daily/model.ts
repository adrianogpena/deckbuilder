export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

export interface Snippet {
  id: string;
  label: string;
  text: string;
}

export interface Daily {
  todos: Todo[];
  scratch: string;
  snippets: Snippet[];
  /** Set when the to-do list comes from Todoist instead of the local file. */
  remote?: boolean;
}

export const MAX_TODOS = 200;
export const MAX_TODO = 200;
export const MAX_SCRATCH = 20000;
export const MAX_SNIPPETS = 50;
export const MAX_LABEL = 40;
export const MAX_SNIPPET = 2000;

export const emptyDaily = (): Daily => ({ todos: [], scratch: '', snippets: [] });

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function parseDaily(raw: unknown): Daily {
  const r = obj(raw);
  const todos: Todo[] = [];
  for (const t of Array.isArray(r.todos) ? r.todos : []) {
    const o = obj(t);
    const text = str(o.text).trim().slice(0, MAX_TODO);
    if (text && str(o.id) && todos.length < MAX_TODOS) todos.push({ id: str(o.id), text, done: o.done === true });
  }
  const snippets: Snippet[] = [];
  for (const s of Array.isArray(r.snippets) ? r.snippets : []) {
    const o = obj(s);
    const label = str(o.label).trim().slice(0, MAX_LABEL);
    const text = str(o.text).slice(0, MAX_SNIPPET);
    if (label && text && str(o.id) && snippets.length < MAX_SNIPPETS) snippets.push({ id: str(o.id), label, text });
  }
  return { todos, scratch: str(r.scratch).slice(0, MAX_SCRATCH), snippets };
}

export function addTodo(d: Daily, id: string, text: string): Daily {
  const t = text.trim().slice(0, MAX_TODO);
  if (!t || d.todos.length >= MAX_TODOS) return d;
  return { ...d, todos: [...d.todos, { id, text: t, done: false }] };
}

export function toggleTodo(d: Daily, id: string): Daily {
  if (!d.todos.some((t) => t.id === id)) return d;
  return { ...d, todos: d.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) };
}

export function editTodo(d: Daily, id: string, text: string): Daily {
  const t = text.trim().slice(0, MAX_TODO);
  if (!t || !d.todos.some((x) => x.id === id)) return d;
  return { ...d, todos: d.todos.map((x) => (x.id === id ? { ...x, text: t } : x)) };
}

export const removeTodo = (d: Daily, id: string): Daily => ({ ...d, todos: d.todos.filter((t) => t.id !== id) });

export const clearDone = (d: Daily): Daily => ({ ...d, todos: d.todos.filter((t) => !t.done) });

export const setScratch = (d: Daily, text: string): Daily => ({ ...d, scratch: text.slice(0, MAX_SCRATCH) });

export function addSnippet(d: Daily, id: string, label: string, text: string): Daily {
  const l = label.trim().slice(0, MAX_LABEL);
  const t = text.slice(0, MAX_SNIPPET);
  if (!l || !t.trim() || d.snippets.length >= MAX_SNIPPETS) return d;
  return { ...d, snippets: [...d.snippets, { id, label: l, text: t }] };
}

export const removeSnippet = (d: Daily, id: string): Daily => ({ ...d, snippets: d.snippets.filter((s) => s.id !== id) });

/** `mm:ss` for a remaining time in milliseconds. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
