/// <reference path="./integration/scripts.d.ts" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShellId } from '../protocol.ts';
// Text imports: `bun build --compile` inlines them, so the exe carries the scripts and writes them out at runtime.
import bashScript from './integration/bash.sh' with { type: 'text' };
import fishScript from './integration/fish.fish' with { type: 'text' };
import pwshScript from './integration/pwsh.ps1' with { type: 'text' };
import zshForward from './integration/zsh-forward.zsh' with { type: 'text' };
import zshrcScript from './integration/zshrc.zsh' with { type: 'text' };

/** Shells that get an integration script. */
export type IntegratedShell = 'bash' | 'git-bash' | 'zsh' | 'fish' | 'powershell' | 'pwsh' | 'cmd';

const lf = (s: string) => s.replace(/\r\n/g, '\n');

/** Files written under the integration dir: relative path → content. */
export function integrationFiles(): Record<string, string> {
  const files: Record<string, string> = {
    'bash.sh': lf(bashScript),
    'fish.fish': lf(fishScript),
    'pwsh.ps1': pwshScript.replace(/\r?\n/g, '\r\n'),
    'zsh/.zshrc': lf(zshrcScript),
  };
  for (const name of ['.zshenv', '.zprofile', '.zlogin']) files[`zsh/${name}`] = lf(zshForward).replaceAll('__DB_FILE__', name);
  return files;
}

const written = new Set<string>();

/** Writes the scripts to `dir` once per process (rewriting any that differ). */
export function ensureIntegrationFiles(dir: string): void {
  if (written.has(dir)) return;
  for (const [rel, content] of Object.entries(integrationFiles())) {
    const path = join(dir, rel);
    let current: string | null = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {}
    if (current === content) continue;
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  written.add(dir);
}

/** The integrated shell an argv runs: the profile's shell id, or for `auto` the executable's name. */
export function integratedShell(id: ShellId | 'custom', argv: string[]): IntegratedShell | null {
  let kind: string = id;
  if (id === 'auto') {
    const exe = argv[0] ?? '';
    kind = exe
      .slice(Math.max(exe.lastIndexOf('/'), exe.lastIndexOf('\\')) + 1)
      .toLowerCase()
      .replace(/\.exe$/, '');
  }
  switch (kind) {
    case 'bash':
    case 'git-bash':
    case 'zsh':
    case 'fish':
    case 'powershell':
    case 'pwsh':
    case 'cmd':
      return kind;
    default:
      return null;
  }
}

/** Forward slashes: Windows shells and Git Bash accept them, and they need no escaping. */
const slashes = (p: string) => p.replace(/\\/g, '/');

const LOGIN_FLAGS = new Set(['-l', '--login', '-i']);

/**
 * Argv and env that load the integration script for `shell` (files already in `dir`).
 * `env` is the env the session would get otherwise; the result merges into it.
 */
export function withIntegration(
  shell: IntegratedShell,
  argv: string[],
  dir: string,
  env: Record<string, string | undefined>,
): { argv: string[]; env: Record<string, string> } {
  const [exe = '', ...args] = argv;
  switch (shell) {
    case 'bash':
    case 'git-bash':
      // --rcfile is ignored by login shells; the script sources the login files itself.
      return { argv: [exe, '--rcfile', slashes(join(dir, 'bash.sh')), ...args.filter((a) => !LOGIN_FLAGS.has(a)), '-i'], env: {} };
    case 'zsh':
      return { argv, env: { ZDOTDIR: join(dir, 'zsh'), KEDALION_USER_ZDOTDIR: env.ZDOTDIR ?? '' } };
    case 'fish':
      return { argv: [...argv, '--init-command', `source '${join(dir, 'fish.fish').replace(/[\\']/g, '\\$&')}'`], env: {} };
    case 'powershell':
    case 'pwsh': {
      // A script block from the file text: dot-sourcing the file itself would fail under the Restricted policy.
      const path = join(dir, 'pwsh.ps1').replace(/'/g, "''");
      return { argv: [...argv, '-NoExit', '-Command', `. ([scriptblock]::Create([IO.File]::ReadAllText('${path}')))`], env: {} };
    }
    case 'cmd': {
      const user = env.PROMPT || '$P$G';
      return { argv, env: { PROMPT: `$E]133;D$E\\$E]7;file://localhost/$P$E\\$E]133;A$E\\${user}$E]133;B$E\\` } };
    }
  }
}
