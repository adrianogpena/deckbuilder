import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentRunning } from '../protocol.ts';

export type RunningRecord = Pick<AgentRunning, 'id' | 'account' | 'mode' | 'project'>;

export interface RunningStore {
  /** Records the sessions live now (written only when they changed). */
  sync(live: RunningRecord[]): void;
  /** The sessions the previous run left live and that are not live now; empty after `dismiss`. */
  recovery(liveIds: Iterable<string>): RunningRecord[];
  dismiss(): void;
}

const valid = (r: unknown): r is RunningRecord => {
  const x = r as RunningRecord | null;
  return !!x && typeof x.id === 'string' && typeof x.account === 'string' && (x.mode === 'terminal' || x.mode === 'chat');
};

/** The live Agents sessions kept in `file` (`{id, account, mode, project?}[]`); what the file held at creation is the "was running" list. */
export function createRunningStore(file: string): RunningStore {
  let previous: RunningRecord[] = [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (Array.isArray(raw)) previous = raw.filter(valid);
  } catch {
    /* no previous run */
  }
  let written = JSON.stringify(previous);
  return {
    sync(live) {
      const text = JSON.stringify(live);
      if (text === written) return;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, text);
        written = text;
      } catch {
        /* best effort */
      }
    },
    recovery(liveIds) {
      const now = new Set(liveIds);
      return previous.filter((r) => !now.has(r.id));
    },
    dismiss() {
      previous = [];
    },
  };
}
