import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentStatus } from '../protocol.ts';

export type { AgentStatus };

export interface PidEntry {
  pid: number;
  sessionId: string;
  cwd?: string;
  status?: string;
  updatedAt?: number;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Reads `<account>/sessions/<pid>.json`; ignores `<pid>.<hash>.key`, unparsable files and dead pids. */
export function readPidFiles(accountDir: string, alive: (pid: number) => boolean = isPidAlive): PidEntry[] {
  const dir = join(accountDir, 'sessions');
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: PidEntry[] = [];
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    try {
      const j = JSON.parse(readFileSync(join(dir, n), 'utf8'));
      const pid = Number(j.pid ?? n.slice(0, -5));
      if (!Number.isInteger(pid) || typeof j.sessionId !== 'string' || !alive(pid)) continue;
      out.push({
        pid,
        sessionId: j.sessionId,
        cwd: typeof j.cwd === 'string' ? j.cwd : undefined,
        status: typeof j.status === 'string' ? j.status : undefined,
        updatedAt: typeof j.updatedAt === 'number' ? j.updatedAt : undefined,
      });
    } catch {
      /* best effort */
    }
  }
  return out;
}

export function mapStatus(raw: string | undefined): 'running' | 'needs-you' | 'idle' {
  if (raw === 'busy' || raw === 'shell') return 'running';
  if (raw === 'waiting') return 'needs-you';
  return 'idle';
}

const ORDER: AgentStatus[] = ['error', 'needs-you', 'running', 'done', 'idle', 'stopped'];

/** Highest-precedence status: error > needs-you > running > done > idle > stopped. */
export function pickStatus(candidates: AgentStatus[]): AgentStatus {
  for (const s of ORDER) if (candidates.includes(s)) return s;
  return 'stopped';
}

/** Tracks transitions across polls: the first status is a baseline, running -> idle becomes done until seen. */
export function createStatusTracker() {
  const prev = new Map<string, 'running' | 'needs-you' | 'idle'>();
  const done = new Set<string>();
  return {
    /** Feed the live pid entries of one poll (all accounts); returns session id -> status (absent = stopped). */
    update(entries: PidEntry[]): Map<string, AgentStatus> {
      const out = new Map<string, AgentStatus>();
      const live = new Set<string>();
      for (const e of entries) {
        live.add(e.sessionId);
        const cur = mapStatus(e.status);
        if (prev.get(e.sessionId) === 'running' && cur === 'idle') done.add(e.sessionId);
        else if (cur !== 'idle') done.delete(e.sessionId);
        prev.set(e.sessionId, cur);
        const shown: AgentStatus = cur === 'idle' && done.has(e.sessionId) ? 'done' : cur;
        const prior = out.get(e.sessionId);
        out.set(e.sessionId, pickStatus(prior ? [shown, prior] : [shown]));
      }
      for (const id of [...prev.keys()]) {
        if (!live.has(id)) {
          prev.delete(id);
          done.delete(id);
        }
      }
      return out;
    },
    /** The user opened the session: clears done. */
    markSeen(sessionId: string) {
      done.delete(sessionId);
    },
  };
}
