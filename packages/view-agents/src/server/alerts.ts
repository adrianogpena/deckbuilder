import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentSessionView, AgentStatus } from '../protocol.ts';
import { createTransitions, type Transitions } from './notify.ts';

export interface AgentAlert {
  id: string;
  status: AgentStatus;
  label: string;
  project: string;
  /** Epoch ms. */
  timestamp: number;
}

export const ALERTS_KEEP = 200;

const FILE = /^(.+)\.(\d+)\.json$/;

/** Alert log: one `<id>.<timestamp>.json` per status transition, newest 200 kept. */
export function createAlerts(dir: () => string | undefined, transitions: Transitions = createTransitions(), now: () => number = Date.now) {
  const files = (d: string): Array<{ name: string; id: string; ts: number }> => {
    try {
      return readdirSync(d).flatMap((name) => {
        const m = FILE.exec(name);
        return m ? [{ name, id: m[1]!, ts: Number(m[2]) }] : [];
      });
    } catch {
      return [];
    }
  };
  const read = (d: string, name: string): AgentAlert | undefined => {
    try {
      const a = JSON.parse(readFileSync(join(d, name), 'utf8')) as AgentAlert;
      return typeof a.id === 'string' && typeof a.status === 'string' && typeof a.timestamp === 'number' ? a : undefined;
    } catch {
      return undefined;
    }
  };
  const list = (): AgentAlert[] => {
    const d = dir();
    if (!d) return [];
    return files(d)
      .sort((a, b) => b.ts - a.ts)
      .flatMap((f) => {
        const a = read(d, f.name);
        return a ? [a] : [];
      });
  };
  return {
    list,
    observe(sessions: AgentSessionView[]): void {
      const changed = transitions.diff(sessions);
      const d = dir();
      if (changed.length === 0 || !d) return;
      try {
        mkdirSync(d, { recursive: true });
        const existing = files(d);
        for (const s of changed) {
          const mine = existing.filter((f) => f.id === s.id).sort((a, b) => b.ts - a.ts)[0];
          if (mine && read(d, mine.name)?.status === s.status) continue;
          let ts = now();
          while (existing.some((f) => f.id === s.id && f.ts === ts)) ts++;
          const entry: AgentAlert = { id: s.id, status: s.status, label: s.name || s.title || s.firstPrompt || s.id, project: s.project ?? '', timestamp: ts };
          const name = `${s.id}.${ts}.json`;
          const tmp = join(d, `${name}.tmp`);
          writeFileSync(tmp, JSON.stringify(entry));
          renameSync(tmp, join(d, name));
          existing.push({ name, id: s.id, ts });
        }
        const all = existing.sort((a, b) => b.ts - a.ts);
        for (const f of all.slice(ALERTS_KEEP)) rmSync(join(d, f.name), { force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
