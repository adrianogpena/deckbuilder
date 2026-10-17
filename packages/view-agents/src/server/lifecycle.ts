import { existsSync, statSync } from 'node:fs';
import type { PidEntry } from './status.ts';

/** A terminal pty running Claude, as the lifecycle sees it (`meta.agentSession` is `sessionId`). */
export interface TermInfo {
  id: string;
  sessionId: string;
  account?: string;
  cwd: string;
  /** Exit code once the process ended (null = no code); undefined while running. */
  exited?: number | null;
}

export interface Adoption {
  terminal: string;
  from: string;
  to: string;
}

export interface LifecycleResult {
  /** Session id changes to apply to the terminals' `meta.agentSession` (`/clear`). */
  adopt: Adoption[];
  /** Session ids (after adoption) whose process has no pid file yet. */
  starting: Set<string>;
  /** Session id -> exit code of ended processes whose terminal is still listed. */
  exited: Map<string, number | null>;
}

/**
 * Links each live terminal to Claude's pid file for its process and follows the session id in it.
 * The pid file with the terminal's session id is bound on first sight (that ends "Starting"); afterwards a
 * different `sessionId` in the bound pid file is `/clear` and is adopted.
 */
export function createLifecycle() {
  const bound = new Map<string, number>();
  return {
    poll(terms: TermInfo[], pids: PidEntry[]): LifecycleResult {
      const adopt: Adoption[] = [];
      const starting = new Set<string>();
      const exited = new Map<string, number | null>();
      const present = new Set(terms.map((x) => x.id));
      for (const id of [...bound.keys()]) if (!present.has(id)) bound.delete(id);
      for (const term of terms) {
        if (term.exited !== undefined) {
          exited.set(term.sessionId, term.exited);
          bound.delete(term.id);
          continue;
        }
        let sessionId = term.sessionId;
        let pid = bound.get(term.id);
        if (pid === undefined) {
          const taken = new Set(bound.values());
          pid = pids.find((e) => e.sessionId === sessionId && !taken.has(e.pid))?.pid;
          if (pid === undefined) {
            starting.add(sessionId);
            continue;
          }
          bound.set(term.id, pid);
        }
        const entry = pids.find((e) => e.pid === pid);
        if (entry && entry.sessionId !== sessionId) {
          adopt.push({ terminal: term.id, from: sessionId, to: entry.sessionId });
          sessionId = entry.sessionId;
        }
      }
      return { adopt, starting, exited };
    },
  };
}

/** Error for a missing cwd, or undefined when it is an existing folder. */
export function cwdProblem(cwd: string): { error: 'cwdMissing'; cwd: string } | undefined {
  try {
    if (existsSync(cwd) && statSync(cwd).isDirectory()) return undefined;
  } catch {
    /* treated as missing */
  }
  return { error: 'cwdMissing', cwd };
}

export type RestartPlan = { ok: false; error: 'external' | 'unknownSession' } | { ok: true; sessionId: string; resume: boolean };

/**
 * What a restart starts: a resumed run when the transcript exists, else a fresh conversation under a new id
 * (resuming an id with no transcript would fail). Sessions open in another terminal are refused.
 */
export function planRestart(s: { known: boolean; external: boolean; sessionId: string; hasTranscript: boolean }, newId: () => string = () => crypto.randomUUID()): RestartPlan {
  if (!s.known) return { ok: false, error: 'unknownSession' };
  if (s.external) return { ok: false, error: 'external' };
  return s.hasTranscript ? { ok: true, sessionId: s.sessionId, resume: true } : { ok: true, sessionId: newId(), resume: false };
}

/** After a stop: the session stays listed only when it can be resumed (a transcript exists); an empty new session is removed. */
export const stopOutcome = (hasTranscript: boolean): { removed: boolean } => ({ removed: !hasTranscript });
