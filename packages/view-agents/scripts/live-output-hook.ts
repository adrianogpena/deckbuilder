/**
 * Claude Code PreToolUse hook for Bash: rewrites a foreground command so its stdout and stderr are also tee'd to
 * `<agentsDir>/live/<sessionId>.log` (truncated at the start of each run, exit code kept). The Agents view's Output
 * panel tails that file to show the output while the command runs. Background commands are left alone.
 *
 * Usage (hook command): `bun live-output-hook.ts [agentsDir]`; agentsDir defaults to `~/.kedalion/agents`.
 * Any failure exits 0 without output, so the hook can never block a command.
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const liveLogPath = (agentsDir: string, sessionId: string): string => join(agentsDir, 'live', `${sessionId.replace(/[^\w-]/g, '_')}.log`);

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** `command` run in a group whose stdout and stderr are also appended to `logFile` (emptied first); the group's exit code is the command's. */
export function wrapCommand(command: string, logFile: string): string {
  const log = quote(logFile.replace(/\\/g, '/'));
  return `: > ${log}\n{\n${command}\n} > >(tee -a ${log}) 2> >(tee -a ${log} >&2)`;
}

interface HookInput {
  session_id?: unknown;
  tool_name?: unknown;
  tool_input?: { command?: unknown; run_in_background?: unknown } & Record<string, unknown>;
}

/** The hook's JSON answer for an input, or undefined when the call is left as it is. */
export function hookOutput(input: HookInput, agentsDir: string): object | undefined {
  const ti = input.tool_input;
  if (input.tool_name !== 'Bash' || !ti || typeof ti.command !== 'string' || ti.run_in_background === true) return undefined;
  if (typeof input.session_id !== 'string' || !input.session_id) return undefined;
  const file = liveLogPath(agentsDir, input.session_id);
  mkdirSync(join(agentsDir, 'live'), { recursive: true });
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...ti, command: wrapCommand(ti.command, file) } } };
}

if (import.meta.main) {
  try {
    const agentsDir = process.argv[2] || join(homedir(), '.kedalion', 'agents');
    const out = hookOutput(JSON.parse(await Bun.stdin.text()) as HookInput, agentsDir);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {
    /* never block the command */
  }
}
