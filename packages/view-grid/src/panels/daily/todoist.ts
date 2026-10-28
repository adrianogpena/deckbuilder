import { sourceFetch, type ResolvedConnection } from '../../server';
import { MAX_TODO, MAX_TODOS, type Todo } from './model';

const headers = (c: ResolvedConnection) => ({ Authorization: `Bearer ${c.token}`, Accept: 'application/json', 'Content-Type': 'application/json' });

const idPath = (id: string) => encodeURIComponent(id);

interface ApiTask {
  id?: unknown;
  content?: unknown;
  priority?: unknown;
  project_id?: unknown;
  labels?: unknown;
  due?: { date?: unknown } | null;
}

/** Project names by id; empty when the lookup fails, so tasks still show without them. */
async function projectNames(c: ResolvedConnection, signal?: AbortSignal): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const url = new URL(`${c.baseUrl}/projects`);
    url.searchParams.set('limit', '200');
    const res = await sourceFetch(url.href, { headers: headers(c) }, { signal });
    const body = (await res.json().catch(() => ({}))) as { results?: Array<{ id?: unknown; name?: unknown }> };
    for (const p of body.results ?? []) if (typeof p.id === 'string' && typeof p.name === 'string') names.set(p.id, p.name);
  } catch {
    /* names are optional */
  }
  return names;
}

function toTodo(t: ApiTask, projects: Map<string, string>): Todo | undefined {
  if (typeof t.id !== 'string' || typeof t.content !== 'string') return undefined;
  const todo: Todo = { id: t.id, text: t.content.slice(0, MAX_TODO), done: false };
  if (typeof t.due?.date === 'string') todo.due = t.due.date;
  if (t.priority === 2 || t.priority === 3 || t.priority === 4) todo.priority = t.priority;
  const project = typeof t.project_id === 'string' ? projects.get(t.project_id) : undefined;
  if (project) todo.project = project;
  const labels = Array.isArray(t.labels) ? t.labels.filter((l): l is string => typeof l === 'string') : [];
  if (labels.length) todo.labels = labels;
  return todo;
}

/** The open tasks (all of them, or those matching a Todoist `filter` query). */
export async function listTasks(c: ResolvedConnection, filter: string, signal?: AbortSignal): Promise<Todo[]> {
  const url = new URL(`${c.baseUrl}/tasks${filter ? '/filter' : ''}`);
  url.searchParams.set('limit', String(MAX_TODOS));
  if (filter) url.searchParams.set('query', filter);
  const [res, projects] = await Promise.all([sourceFetch(url.href, { headers: headers(c) }, { signal }), projectNames(c, signal)]);
  const body = (await res.json().catch(() => ({}))) as { results?: ApiTask[] };
  const todos: Todo[] = [];
  for (const t of body.results ?? []) {
    const todo = toTodo(t, projects);
    if (todo) todos.push(todo);
  }
  return todos;
}

/**
 * Adds a task through Todoist's quick add, so "buy milk tomorrow 5pm p1 #Home @errand" sets
 * the date, priority, project and label. A task left without a date in a filter on "today"
 * is made due today so it shows up in the list.
 */
export async function addTask(c: ResolvedConnection, text: string, filter: string): Promise<void> {
  const res = await sourceFetch(`${c.baseUrl}/tasks/quick`, { method: 'POST', headers: headers(c), body: JSON.stringify({ text: text.trim().slice(0, MAX_TODO) }) });
  if (!/\btoday\b/i.test(filter)) return;
  const task = (await res.json().catch(() => ({}))) as ApiTask;
  if (typeof task.id === 'string' && !task.due) {
    await sourceFetch(`${c.baseUrl}/tasks/${idPath(task.id)}`, { method: 'POST', headers: headers(c), body: JSON.stringify({ due_string: 'today' }) });
  }
}

export async function renameTask(c: ResolvedConnection, id: string, text: string): Promise<void> {
  await sourceFetch(`${c.baseUrl}/tasks/${idPath(id)}`, { method: 'POST', headers: headers(c), body: JSON.stringify({ content: text.trim().slice(0, MAX_TODO) }) });
}

export async function closeTask(c: ResolvedConnection, id: string): Promise<void> {
  await sourceFetch(`${c.baseUrl}/tasks/${idPath(id)}/close`, { method: 'POST', headers: headers(c) });
}

export async function reopenTask(c: ResolvedConnection, id: string): Promise<void> {
  await sourceFetch(`${c.baseUrl}/tasks/${idPath(id)}/reopen`, { method: 'POST', headers: headers(c) });
}

export async function deleteTask(c: ResolvedConnection, id: string): Promise<void> {
  await sourceFetch(`${c.baseUrl}/tasks/${idPath(id)}`, { method: 'DELETE', headers: headers(c) });
}
