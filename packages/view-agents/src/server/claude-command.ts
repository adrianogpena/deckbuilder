import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentsSettings } from '../settings-types.ts';
import { claudeArgsKey, claudeCommandKey } from './hooks.ts';

const PACKAGE = ['@anthropic-ai', 'claude-code'] as const;

/** System lookups of the resolution; tests replace them. */
export interface CommandDeps {
  platform: NodeJS.Platform;
  /** Lines `where.exe <name>` prints, empty when nothing is found. */
  where(name: string): string[];
  exists(path: string): boolean;
  readText(path: string): string | undefined;
}

export const systemDeps: CommandDeps = {
  platform: process.platform,
  where(name) {
    try {
      const r = Bun.spawnSync(['where.exe', name], { stdout: 'pipe', stderr: 'ignore', windowsHide: true });
      return r.exitCode === 0 ? r.stdout.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  },
  exists: (p) => existsSync(p),
  readText(p) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  },
};

export interface ResolvedCommand {
  /** Program and leading args (`cmd.exe /c <shim>` for a `.cmd`/`.bat`). */
  argv: string[];
  /** False when nothing was found and `argv` is a guess. */
  available: boolean;
}

const isBatch = (p: string) => /\.(cmd|bat)$/i.test(p);
const viaInterpreter = (p: string): string[] => ['cmd.exe', '/c', p];

/** True when `argv` runs a `.cmd`/`.bat` through `cmd.exe /c`, which re-parses every following argument. */
export const isViaInterpreter = (argv: readonly string[]): boolean => argv[0] === 'cmd.exe' && argv[1] === '/c';

/**
 * Whether an argument survives `cmd.exe /c <shim>` unchanged. The spawn quotes arguments with
 * CreateProcess rules (backslash-escaped `"`), which cmd.exe and the shim's `%*` do not honour, so
 * cmd-escaping cannot be made reliable; arguments with cmd metacharacters or line breaks are refused instead.
 */
export const isInterpreterSafeArg = (arg: string): boolean => !/[\r\n"%!^&|<>()]/.test(arg);

/** The native binary an npm shim's package declares in its `bin` field, when it is an existing `.exe`. */
function nativeFromShim(shim: string, agent: string, deps: CommandDeps): string | undefined {
  const pkgDir = join(dirname(shim), 'node_modules', ...PACKAGE);
  const text = deps.readText(join(pkgDir, 'package.json'));
  if (!text) return undefined;
  let bin: unknown;
  try {
    bin = (JSON.parse(text) as { bin?: unknown }).bin;
  } catch {
    return undefined;
  }
  const rel = typeof bin === 'string' ? bin : bin && typeof bin === 'object' ? ((bin as Record<string, unknown>)[agent] ?? Object.values(bin)[0]) : undefined;
  if (typeof rel !== 'string' || !/\.exe$/i.test(rel)) return undefined;
  const exe = join(pkgDir, rel);
  return deps.exists(exe) ? exe : undefined;
}

/** Spec order: a configured command as-is (a `.cmd`/`.bat` through the interpreter), else on Windows `claude.exe`, the npm shim's native binary, the shim itself, then a marked guess. */
export function resolveClaudeCommand(configured: string | undefined, deps: CommandDeps = systemDeps, agent = 'claude'): ResolvedCommand {
  const set = configured?.trim();
  if (set) return { argv: deps.platform === 'win32' && isBatch(set) ? viaInterpreter(set) : [set], available: true };
  if (deps.platform !== 'win32') return { argv: [agent], available: true };
  const exe = deps.where(`${agent}.exe`)[0];
  if (exe) return { argv: [exe], available: true };
  const shim = deps.where(`${agent}.cmd`)[0];
  if (shim) {
    const native = nativeFromShim(shim, agent, deps);
    return { argv: native ? [native] : viaInterpreter(shim), available: true };
  }
  return { argv: [`${agent}.exe`], available: false };
}

export interface ClaudeCommand {
  /** Program and its leading args; resolved once and cached. */
  argv(): string[];
  /** `agents.claudeArgs`, appended after the launcher's own args. */
  extraArgs(): string[];
  available(): boolean;
  /** Re-reads the `agents` settings and drops the cache. */
  configure(agents: AgentsSettings | undefined): void;
  /** Sets the approval check (`claudeCommandKey`/`claudeArgsKey`); an unapproved command falls back to detection, unapproved args are dropped. */
  setApproved(approved: (key: string) => boolean): void;
}

export function createClaudeCommand(deps: CommandDeps = systemDeps, approved: (key: string) => boolean = () => true): ClaudeCommand {
  let agents: AgentsSettings | undefined;
  let cached: { set: string | undefined; r: ResolvedCommand } | undefined;
  const allowedCommand = () => {
    const set = agents?.claudeCommand?.trim();
    return set && approved(claudeCommandKey(set)) ? set : undefined;
  };
  const get = () => {
    const set = allowedCommand();
    if (!cached || cached.set !== set) cached = { set, r: resolveClaudeCommand(set, deps) };
    return cached.r;
  };
  return {
    argv: () => [...get().argv],
    extraArgs: () => {
      const args = agents?.claudeArgs ?? [];
      return args.length > 0 && approved(claudeArgsKey(args)) ? [...args] : [];
    },
    available: () => get().available,
    configure(next) {
      agents = next;
      cached = undefined;
    },
    setApproved(next) {
      approved = next;
      cached = undefined;
    },
  };
}

/** Shared by the pty launcher and the settings hooks of the server view; nothing configured is used until the view sets the approval check. */
export const claudeCommand: ClaudeCommand = createClaudeCommand(systemDeps, () => false);
