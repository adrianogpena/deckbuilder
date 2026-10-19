import type { AgentAccount } from './accounts.ts';

/** Variables of an enclosing Claude Code session that must not leak into a launched one (compared case-insensitively). */
export const SCRUBBED_ENV = [
  'COLORTERM', 'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_SSE_PORT',
] as const;
const SCRUBBED = new Set<string>(SCRUBBED_ENV);

/** Inherited env minus `SCRUBBED_ENV`, plus `COLORTERM=truecolor`. Spec §2: `CLAUDE_CONFIG_DIR` is set for non-default accounts and never for the default one. */
export function claudeEnv(account: Pick<AgentAccount, 'dir' | 'isDefault'>, base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !SCRUBBED.has(k.toUpperCase())) env[k] = v;
  env.COLORTERM = 'truecolor';
  if (account.isDefault) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = account.dir;
  return env;
}
