import { request } from '@deckbuilderkit/ui';

export interface RunTarget {
  id: string;
  label: string;
  source: string;
}

export interface RunState {
  target: string;
  status: 'running' | 'stopped' | 'exited';
  exitCode?: number | null;
  url?: string;
  log: string;
}

export const getTargets = (project: string) => request<{ targets: RunTarget[]; runs: RunState[] }>('GET', '/api/agents/run/targets', { project });
export const getLogs = (project: string, target: string) => request<RunState>('GET', '/api/agents/run/logs', { project, target });
export const startRun = (project: string, target: string) => request<RunState>('POST', '/api/agents/run/start', {}, { project, target });
export const stopRun = (project: string, target: string) => request<RunState>('POST', '/api/agents/run/stop', {}, { project, target });
export const openRunUrl = (project: string, target: string) => request<{ ok: boolean }>('POST', '/api/agents/run/open', {}, { project, target });
