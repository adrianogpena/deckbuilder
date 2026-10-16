import { isUuid, type Launcher } from '@deckbuilderkit/terminal/server';
import type { AgentAccount } from './accounts.ts';
import { claudeEnv } from './chat/process.ts';

export const CLAUDE_LAUNCHER_ID = 'claude';

/** Validated launcher args: a new session passes its own id (`--session-id`), a resumed one `--resume`. */
export interface ClaudeLaunchArgs {
  account: string;
  sessionId: string;
  resume: boolean;
}

export interface ClaudeLauncherOptions {
  accounts(): AgentAccount[];
  /** Base environment of the pty; defaults to the server's. */
  env?: Record<string, string | undefined>;
  /** Executable; defaults to `claude.cmd` on Windows, else `claude`. */
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
      return { account: a.account, sessionId: a.sessionId, resume: a.resume === true };
    },
    command: (a) => [opts.cmd ?? (process.platform === 'win32' ? 'claude.cmd' : 'claude'), a.resume ? '--resume' : '--session-id', a.sessionId],
    env: (a) => claudeEnv(find(a.account)!, opts.env ?? process.env),
    meta: (a) => ({ agentSession: a.sessionId, account: a.account }),
  };
}
