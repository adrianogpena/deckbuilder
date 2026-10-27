import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ndjson, notFound } from '@kedalion/server-core';
import { findSessionFile } from '../chat/normalize.ts';
import { newestTranscript } from './output.ts';
import type { PanelRoutes } from './ctx.ts';

/** Runs kept per session. */
export const MAX_WORKFLOWS = 30;
/** A run whose journal changed this recently still counts as running even when every started agent has a result. */
const IDLE_MS = 20_000;
const WATCH_MS = 500;
const REFRESH_MS = 3_000;
const SUMMARY_MAX = 300;

export type WorkflowStatus = 'running' | 'done' | 'failed';
export type AgentStatus = 'running' | 'done' | 'failed';

export interface WorkflowAgent {
  agentId: string;
  label: string;
  phase?: string;
  status: AgentStatus;
  /** Short result: its summary, or the text of the result. */
  summary?: string;
}

export interface WorkflowRun {
  runId: string;
  /** Description of the run: the label of its first agent, falling back to the id. */
  name: string;
  status: WorkflowStatus;
  /** Phases in order of first appearance. */
  phases: string[];
  agents: WorkflowAgent[];
  startedAt?: number;
  updatedAt?: number;
}

export interface WorkflowsPayload {
  runs: WorkflowRun[];
}

const clip = (s: string) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX)}…` : s);

const isFailure = (result: unknown): boolean => {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  const status = typeof r.status === 'string' ? r.status.toLowerCase() : '';
  return status === 'failed' || status === 'error' || r.error !== undefined || r.is_error === true;
};

const summaryOf = (result: unknown): string | undefined => {
  if (result === undefined || result === null) return undefined;
  if (typeof result === 'string') return clip(result.trim());
  if (typeof result !== 'object') return String(result);
  const r = result as Record<string, unknown>;
  for (const k of ['summary', 'error', 'message', 'text']) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) return clip(v.trim());
    if (v && typeof v === 'object' && k === 'error') return clip(JSON.stringify(v));
  }
  return clip(JSON.stringify(result));
};

/** Parses one run's `journal.jsonl` (records `launched`, `started` {agentId,label,phase}, `result` {agentId,result}). */
export function parseJournal(text: string, runId: string, times: { startedAt?: number; updatedAt?: number } = {}, now = Date.now()): WorkflowRun {
  const agents = new Map<string, WorkflowAgent>();
  const phases: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const key = typeof rec.agentId === 'string' ? rec.agentId : typeof rec.key === 'string' ? rec.key : undefined;
    if (!key) continue;
    if (rec.type === 'started') {
      const phase = typeof rec.phase === 'string' && rec.phase ? rec.phase : undefined;
      if (phase && !phases.includes(phase)) phases.push(phase);
      agents.set(key, { agentId: key, label: typeof rec.label === 'string' && rec.label ? rec.label : key, phase, status: 'running' });
    } else if (rec.type === 'result') {
      const cur = agents.get(key) ?? { agentId: key, label: key, status: 'running' as AgentStatus };
      cur.status = isFailure(rec.result) ? 'failed' : 'done';
      cur.summary = summaryOf(rec.result);
      agents.set(key, cur);
    }
  }
  const list = [...agents.values()];
  const recent = times.updatedAt !== undefined && now - times.updatedAt < IDLE_MS;
  const status: WorkflowStatus = list.some((a) => a.status === 'running') || (recent && list.length === 0) ? 'running' : list.some((a) => a.status === 'failed') ? 'failed' : recent ? 'running' : 'done';
  return { runId, name: list[0]?.label ?? runId, status, phases, agents: list, startedAt: times.startedAt, updatedAt: times.updatedAt };
}

/** The directory holding a session's workflow runs, next to its transcript. */
export function workflowsDir(accountDirs: string[], project: string, sessionId?: string): string | undefined {
  let file: string | undefined;
  if (sessionId) {
    for (const dir of accountDirs) {
      file = findSessionFile(dir, sessionId);
      if (file) break;
    }
  } else file = newestTranscript(accountDirs, project);
  if (!file) return undefined;
  const dir = join(dirname(file), file.slice(dirname(file).length + 1).replace(/\.jsonl$/, ''), 'subagents', 'workflows');
  return existsSync(dir) ? dir : undefined;
}

interface Built {
  payload: WorkflowsPayload;
  stamp: string;
}

/** Stat-only stamp of a workflows dir (run names, journal sizes and mtimes); changes when any journal does. */
export function workflowsStamp(dir: string | undefined): string {
  if (!dir) return '';
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return '';
  }
  let stamp = '';
  for (const name of names) {
    try {
      const st = statSync(join(dir, name, 'journal.jsonl'));
      stamp += `${name}:${st.size}:${st.mtimeMs}|`;
    } catch {
      continue;
    }
  }
  return stamp;
}

export function buildWorkflows(dir: string | undefined, now = Date.now()): Built {
  if (!dir) return { payload: { runs: [] }, stamp: '' };
  const runs: WorkflowRun[] = [];
  let stamp = '';
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return { payload: { runs: [] }, stamp: '' };
  }
  for (const name of names) {
    const journal = join(dir, name, 'journal.jsonl');
    try {
      const st = statSync(journal);
      const started = statSync(join(dir, name));
      stamp += `${name}:${st.size}:${st.mtimeMs}|`;
      runs.push(parseJournal(readFileSync(journal, 'utf8'), name, { startedAt: Math.round(started.birthtimeMs || started.mtimeMs), updatedAt: Math.round(st.mtimeMs) }, now));
    } catch {
      continue;
    }
  }
  runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return { payload: { runs: runs.slice(0, MAX_WORKFLOWS) }, stamp };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `GET /api/agents/workflows?project=&sessionId=` lists the workflow runs of the session (newest first); `/stream` pushes it as ndjson on every journal change. */
export const routes: PanelRoutes = (ctx) => {
  const dirOf = (q: URLSearchParams) => {
    const project = q.get('project');
    const root = project ? ctx.projectRoot(project) : undefined;
    if (!root) throw notFound('project', 'Unknown project.');
    return { accountDirs: ctx.accountDirs?.() ?? [], root, sessionId: q.get('sessionId') || undefined };
  };
  const current = (q: URLSearchParams) => {
    const o = dirOf(q);
    return workflowsDir(o.accountDirs, o.root, o.sessionId);
  };
  return {
    'GET /api/agents/workflows': ({ query: q }) => buildWorkflows(current(q)).payload,
    'GET /api/agents/workflows/stream': ({ req, query: q }) => {
      const o = dirOf(q);
      return ndjson(req, async (emit, signal) => {
        let sent = '';
        let last = 0;
        let sig: string | undefined;
        while (!signal.aborted) {
          const now = Date.now();
          const dir = workflowsDir(o.accountDirs, o.root, o.sessionId);
          const stamp = `${dir ?? ''}>${workflowsStamp(dir)}`;
          if (stamp !== sig || now - last >= REFRESH_MS) {
            const built = buildWorkflows(dir, now);
            sig = stamp;
            last = now;
            const json = JSON.stringify(built.payload);
            if (json !== sent) {
              sent = json;
              await emit(built.payload);
            }
          }
          await sleep(WATCH_MS);
        }
      });
    },
  };
};
