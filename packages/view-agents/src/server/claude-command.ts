import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentsSettings } from '../settings-types.ts';

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
}

export function createClaudeCommand(deps: CommandDeps = systemDeps): ClaudeCommand {
  let agents: AgentsSettings | undefined;
  let cached: ResolvedCommand | undefined;
  const get = () => (cached ??= resolveClaudeCommand(agents?.claudeCommand, deps));
  return {
    argv: () => [...get().argv],
    extraArgs: () => [...(agents?.claudeArgs ?? [])],
    available: () => get().available,
    configure(next) {
      agents = next;
      cached = undefined;
    },
  };
}

/** Shared by the pty launcher and the settings hooks of the server view. */
export const claudeCommand: ClaudeCommand = createClaudeCommand();
