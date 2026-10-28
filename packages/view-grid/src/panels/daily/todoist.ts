import { sourceFetch, type ResolvedConnection } from '../../server';
import { MAX_TODO, MAX_TODOS, type Todo } from './model';

const headers = (c: ResolvedConnection) => ({ Authorization: `Bearer ${c.token}`, Accept: 'application/json', 'Content-Type': 'application/json' });

const idPath = (id: string) => encodeURIComponent(id);

/** The open tasks (all of them, or those matching a Todoist `filter` query). */
export async function listTasks(c: ResolvedConnection, filter: string, signal?: AbortSignal): Promise<Todo[]> {
  const url = new URL(`${c.baseUrl}/tasks${filter ? '/filter' : ''}`);
  url.searchParams.set('limit', String(MAX_TODOS));
  if (filter) url.searchParams.set('query', filter);
  const res = await sourceFetch(url.href, { headers: headers(c) }, { signal });
  const body = (await res.json().catch(() => ({}))) as { results?: Array<{ id?: unknown; content?: unknown }> };
  const todos: Todo[] = [];
  for (const t of body.results ?? []) {
    if (typeof t.id === 'string' && typeof t.content === 'string') todos.push({ id: t.id, text: t.content.slice(0, MAX_TODO), done: false });
  }
  return todos;
}

/** Adds a task; one filtered on "today" is due today so it shows up in the list. */
export async function addTask(c: ResolvedConnection, text: string, filter: string): Promise<void> {
  const body: Record<string, string> = { content: text.trim().slice(0, MAX_TODO) };
  if (/\btoday\b/i.test(filter)) body.due_string = 'today';
  await sourceFetch(`${c.baseUrl}/tasks`, { method: 'POST', headers: headers(c), body: JSON.stringify(body) });
}

export async function renameTask(c: ResolvedConnection, id: string, text: string): Promise<void> {
  await sourceFetch(`${c.baseUrl}/tasks/${idPath(id)}`, { method: 'POST', headers: headers(c), body: JSON.stringify({ content: text.trim().slice(0, MAX_TODO) }) });
}

export async function closeTask(c: ResolvedConnection, id: string): Promise<void> {
  await sourceFetch(`${c.baseUrl}/tasks/${idPath(id)}/close`, { method: 'POST', headers: headers(c) });
}

export async function deleteTask(c: ResolvedConnection, id: string): Promise<void> {
  await sourceFetch(`${c.baseUrl}/tasks/${idPath(id)}`, { method: 'DELETE', headers: headers(c) });
}
