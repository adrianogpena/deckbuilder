import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { invalid, notFound } from '@deckbuilderkit/server-core';
import { readJsonFile, writeJsonAtomic } from '@deckbuilderkit/platform';
import { projectKey } from '../projects.ts';
import type { PanelRoutes } from './ctx.ts';

const MAX_NOTES = 200_000;
const MAX_TODOS = 500;
const MAX_TODO_TEXT = 1000;

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

export interface Scratchpad {
  notes: string;
  todos: Todo[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The scratchpad if `v` has its shape (limits included), else undefined. */
export function toScratchpad(v: unknown): Scratchpad | undefined {
  if (!isObject(v) || typeof v.notes !== 'string' || v.notes.length > MAX_NOTES) return undefined;
  if (!Array.isArray(v.todos) || v.todos.length > MAX_TODOS) return undefined;
  const todos: Todo[] = [];
  for (const x of v.todos) {
    if (!isObject(x) || typeof x.id !== 'string' || !x.id || typeof x.text !== 'string' || x.text.length > MAX_TODO_TEXT || typeof x.done !== 'boolean') return undefined;
    todos.push({ id: x.id, text: x.text, done: x.done });
  }
  return { notes: v.notes, todos };
}

export interface ScratchpadStore {
  fileOf(project: string): string;
  read(project: string): Promise<Scratchpad>;
  write(project: string, pad: unknown): Promise<boolean>;
}

/** One file per project in `dir`: `<sha1 of the project path>.json`. */
export function createScratchpadStore(dir: string): ScratchpadStore {
  const fileOf = (project: string) => join(dir, `${createHash('sha1').update(projectKey(project)).digest('hex')}.json`);
  return {
    fileOf,
    async read(project) {
      const raw = (await readJsonFile(fileOf(project), (v) => isObject(v) && toScratchpad(v.pad) !== undefined).catch(() => undefined)) as { pad: unknown } | undefined;
      return toScratchpad(raw?.pad) ?? { notes: '', todos: [] };
    },
    async write(project, pad) {
      const value = toScratchpad(pad);
      if (!value) return false;
      await writeJsonAtomic(fileOf(project), { version: 1, project, pad: value });
      return true;
    },
  };
}

/** Server routes of the scratchpad panel: notes and to-dos of a project, saved under `<agentsDir>/scratchpad`. */
export const routes: PanelRoutes = (ctx) => {
  const store = createScratchpadStore(join(ctx.agentsDir, 'scratchpad'));
  const rootOf = (project: unknown) => {
    const root = typeof project === 'string' && project ? ctx.projectRoot(project) : undefined;
    if (!root) throw notFound('project', 'Unknown project.');
    return root;
  };
  return {
    'GET /api/agents/scratchpad': async ({ query }) => store.read(rootOf(query.get('project'))),
    'PUT /api/agents/scratchpad': async ({ query, json }) => {
      const b = await json<{ notes?: unknown; todos?: unknown }>();
      if (!(await store.write(rootOf(query.get('project')), { notes: b.notes, todos: b.todos }))) throw invalid('scratchpad', 'Not a scratchpad');
      return { ok: true };
    },
  };
};
