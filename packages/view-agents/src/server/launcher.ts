import { isUuid, type Launcher } from '@deckbuilderkit/terminal/server';
import type { AgentAccount } from './accounts.ts';
import { claudeEnv } from './claude-env.ts';
import { claudeCommand } from './claude-command.ts';

export const CLAUDE_LAUNCHER_ID = 'claude';
const MAX_PROMPT = 30_000;

/** Validated launcher args: a new session passes its own id (`--session-id`), a resumed one `--resume`. */
export interface ClaudeLaunchArgs {
  account: string;
  sessionId: string;
  resume: boolean;
  /** `--permission-mode` of a new session (the Task panel's plan and implement sessions). */
  mode?: 'plan' | 'acceptEdits';
  /** Initial prompt of a new session. */
  prompt?: string;
}

export interface ClaudeLauncherOptions {
  accounts(): AgentAccount[];
  /** Base environment of the pty; defaults to the server's. */
  env?: Record<string, string | undefined>;
  /** Executable (tests); defaults to the resolved `claudeCommand` (settings, then detection). */
  cmd?: string;
}

/** Terminal launcher `claude`: the CLI under an account's config dir. `meta.agentSession` links the pty to its Claude session. */
export function claudeLauncher(opts: ClaudeLauncherOptions): Launcher<ClaudeLaunchArgs> {
  const find = (id: string) => opts.accounts().find((a) => a.id === id);
  return {
    label: 'Claude',
    parse(args) {
      if (typeof args !== 'object' || args === null) return null;
      const a = args as Record<string, unknown>;
      if (typeof a.account !== 'string' || !find(a.account) || !isUuid(a.sessionId)) return null;
      if (a.resume !== undefined && typeof a.resume !== 'boolean') return null;
      if (a.mode !== undefined && a.mode !== 'plan' && a.mode !== 'acceptEdits') return null;
      if (a.prompt !== undefined && (typeof a.prompt !== 'string' || a.prompt.length > MAX_PROMPT)) return null;
      return { account: a.account, sessionId: a.sessionId, resume: a.resume === true, mode: a.mode, prompt: a.prompt };
    },
    command: (a) => [
      ...(opts.cmd ? [opts.cmd] : claudeCommand.argv()),
      a.resume ? '--resume' : '--session-id',
      a.sessionId,
      ...(a.mode ? ['--permission-mode', a.mode] : []),
      ...(a.prompt ? [a.prompt] : []),
      ...claudeCommand.extraArgs(),
    ],
    env: (a) => claudeEnv(find(a.account)!, opts.env ?? process.env),
    meta: (a) => ({ agentSession: a.sessionId, account: a.account }),
  };
}
