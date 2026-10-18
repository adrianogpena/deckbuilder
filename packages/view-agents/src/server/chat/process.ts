import type { AgentAccount } from '../accounts.ts';
import type { PermissionMode } from '../../chat-protocol.ts';
import { PERM_TOOL_NAME } from './permission-mcp.ts';

/** The part of a child process the chat engine uses; tests replace it with a scripted fake. */
export interface SpawnedProcess {
  stdin: { write(data: string): unknown; flush?(): unknown; end?(): unknown };
  stdout: AsyncIterable<Uint8Array>;
  kill(): void;
  exited: Promise<number>;
}

export type SpawnFn = (cmd: string[], opts: { cwd: string; env: Record<string, string> }) => SpawnedProcess;

export const bunSpawn: SpawnFn = (cmd, { cwd, env }) =>
  Bun.spawn(cmd, { cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', windowsHide: true }) as unknown as SpawnedProcess;

/** `claude.cmd` on Windows (Bun does not resolve the npm shim by its bare name), else `claude`. */
export const defaultClaudeCommand = () => (process.platform === 'win32' ? 'claude.cmd' : 'claude');

export interface ChatArgs {
  resume?: string;
  permissionMode: PermissionMode;
  /** Path of the `--mcp-config` file (a file, not inline JSON: `.cmd` shims mangle the quotes). */
  mcpConfig: string;
  model?: string;
}

export function buildChatArgs(a: ChatArgs): string[] {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--mcp-config', a.mcpConfig,
    '--permission-prompt-tool', PERM_TOOL_NAME,
    '--permission-mode', a.permissionMode,
  ];
  if (a.model) args.push('--model', a.model);
  if (a.resume) args.push('--resume', a.resume);
  return args;
}

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

export interface ChatProcessHandlers {
  /** A parsed stdout line (control responses are consumed here and not passed on). */
  onMessage(msg: Record<string, any>): void;
  onExit(code: number): void;
}

/** One `claude -p` stream-json process, kept alive across turns. */
export class ChatProcess {
  alive = true;
  private proc: SpawnedProcess;
  private controls = new Map<string, (ok: boolean) => void>();
  private nextControl = 1;

  constructor(spawn: SpawnFn, cmd: string[], opts: { cwd: string; env: Record<string, string> }, private handlers: ChatProcessHandlers) {
    this.proc = spawn(cmd, opts);
    void this.pump();
  }

  private async pump() {
    const dec = new TextDecoder();
    let buf = '';
    const line = (text: string) => {
      if (!text.trim()) return;
      let msg: Record<string, any>;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === 'control_response') {
        const id = msg.response?.request_id;
        this.controls.get(id)?.(msg.response?.subtype === 'success');
        this.controls.delete(id);
        return;
      }
      this.handlers.onMessage(msg);
    };
    try {
      for await (const chunk of this.proc.stdout) {
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          line(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
      line(buf);
    } catch {
      /* stream closed under us: treated as exit */
    }
    const code = await this.proc.exited.catch(() => -1);
    this.alive = false;
    for (const done of this.controls.values()) done(false);
    this.controls.clear();
    this.handlers.onExit(code);
  }

  private write(obj: unknown) {
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
    this.proc.stdin.flush?.();
  }

  sendUser(text: string) {
    this.write({ type: 'user', message: { role: 'user', content: text } });
  }

  /** True when the CLI acknowledged the interrupt; false when it did not answer in time or is gone (kill and resume then). */
  interrupt(timeoutMs = 3000): Promise<boolean> {
    if (!this.alive) return Promise.resolve(false);
    const id = `int-${this.nextControl++}`;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.controls.delete(id);
        resolve(false);
      }, timeoutMs);
      this.controls.set(id, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
      try {
        this.write({ type: 'control_request', request_id: id, request: { subtype: 'interrupt' } });
      } catch {
        this.controls.delete(id);
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  kill() {
    if (!this.alive) return;
    try {
      this.proc.stdin.end?.();
    } catch {
      /* already closed */
    }
    this.proc.kill();
  }
}
