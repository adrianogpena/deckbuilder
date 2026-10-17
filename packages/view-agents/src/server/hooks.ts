import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { type AgentCategory, type AgentSessionView, STATUS_CATEGORY } from '../protocol.ts';
import type { AgentsSettings } from '../settings-types.ts';
import type { Transitions } from './notify.ts';

export type HookKey = 'onRunning' | 'onWaiting' | 'onDone' | 'onError';

export type HookSpawn = (command: string, opts: { cwd?: string; env: Record<string, string> }) => Promise<void>;

export interface HooksOptions {
  settings: () => Promise<AgentsSettings | undefined>;
  /** Flash a failure to start (shown once per run). */
  flash: (message: string) => void;
  /** Starts the command detached; rejects when it cannot start. */
  spawn?: HookSpawn;
}

/** Hook for a status: by category, with Done split from Waiting. */
export function hookKey(status: AgentSessionView['status']): HookKey | undefined {
  if (status === 'done') return 'onDone';
  const cat: AgentCategory = STATUS_CATEGORY[status];
  return cat === 'running' ? 'onRunning' : cat === 'waiting' ? 'onWaiting' : cat === 'error' ? 'onError' : undefined;
}

export const defaultHookSpawn: HookSpawn = (command, { cwd, env }) =>
  new Promise((resolve, reject) => {
    const win = process.platform === 'win32';
    const child = spawn(win ? 'cmd' : 'sh', win ? ['/C', command] : ['-c', command], {
      cwd: cwd && existsSync(cwd) ? cwd : undefined,
      env: { ...process.env, ...env },
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

/** Runs the user's hook command on each status transition (shared detection with the notifier). */
export function createHooks(opts: HooksOptions, transitions: Transitions) {
  const run = opts.spawn ?? defaultHookSpawn;
  return {
    async observe(sessions: AgentSessionView[]): Promise<void> {
      const changed = transitions.diff(sessions);
      if (changed.length === 0) return;
      const cfg = await opts.settings().catch(() => undefined);
      if (!cfg) return;
      for (const s of changed) {
        const key = hookKey(s.status);
        const raw = key ? cfg[`hooks.${key}` as const] : undefined;
        const command = typeof raw === 'string' ? raw.trim() : '';
        if (!command) continue;
        const env = { DECKBUILDER_SESSION_ID: s.id, DECKBUILDER_STATUS: s.status, DECKBUILDER_LABEL: s.name || s.title || s.firstPrompt || s.id, DECKBUILDER_PROJECT: s.project ?? '', DECKBUILDER_CWD: s.cwd };
        void run(command, { cwd: s.cwd, env }).catch((e: unknown) => opts.flash(`Hook failed to start: ${e instanceof Error ? e.message : String(e)}`));
      }
    },
  };
}
