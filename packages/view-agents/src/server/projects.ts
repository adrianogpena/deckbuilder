import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentProject } from '../protocol.ts';

export interface ProjectsStore {
  list(): AgentProject[];
  add(input: { name?: unknown; path?: unknown }): AgentProject | null;
  remove(id: string): boolean;
}

const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const same = (a: string, b: string) => slash(a) === slash(b);

/** The projects added to the Agents view, kept in `file` (`{id, name, path}[]`). */
export function createProjectsStore(file: string): ProjectsStore {
  let items: AgentProject[] | undefined;
  const load = () => {
    if (items) return items;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      items = Array.isArray(raw)
        ? raw.filter((p): p is AgentProject => !!p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.path === 'string')
        : [];
    } catch {
      items = [];
    }
    return items;
  };
  const save = () => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(items ?? []));
    } catch {
      /* best effort */
    }
  };
  return {
    list: () => [...load()],
    add({ name, path }) {
      if (typeof path !== 'string' || !path.trim()) return null;
      const p = path.trim();
      const existing = load().find((x) => same(x.path, p));
      if (existing) return existing;
      const project = { id: crypto.randomUUID(), name: typeof name === 'string' && name.trim() ? name.trim() : base(p), path: p };
      load().push(project);
      save();
      return project;
    },
    remove(id) {
      const before = load().length;
      items = load().filter((x) => x.id !== id);
      if (items.length === before) return false;
      save();
      return true;
    },
  };
}
