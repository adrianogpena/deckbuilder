import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createClaudeCommand, type CommandDeps, resolveClaudeCommand } from './claude-command.ts';
import { claudeEnv, SCRUBBED_ENV } from './chat/process.ts';

const SHIM_DIR = 'C:/npm';
const SHIM = `${SHIM_DIR}/claude.cmd`;
const PKG = join(SHIM_DIR, 'node_modules', '@anthropic-ai', 'claude-code');

function deps(o: { exe?: string[]; cmd?: string[]; bin?: unknown; files?: string[]; platform?: NodeJS.Platform }): CommandDeps {
  return {
    platform: o.platform ?? 'win32',
    where: (n) => (n === 'claude.exe' ? (o.exe ?? []) : n === 'claude.cmd' ? (o.cmd ?? []) : []),
    exists: (p) => (o.files ?? []).includes(p),
    readText: (p) => (p === join(PKG, 'package.json') && o.bin !== undefined ? JSON.stringify({ bin: o.bin }) : undefined),
  };
}

test('a configured command is used as-is, a .cmd/.bat through the interpreter', () => {
  expect(resolveClaudeCommand('D:/x/claude.exe', deps({ exe: ['C:/other.exe'] })).argv).toEqual(['D:/x/claude.exe']);
  expect(resolveClaudeCommand('D:/x/c.bat', deps({})).argv).toEqual(['cmd.exe', '/c', 'D:/x/c.bat']);
  expect(resolveClaudeCommand('   ', deps({ exe: ['C:/a/claude.exe'] })).argv).toEqual(['C:/a/claude.exe']);
});

test('windows: where claude.exe wins over the shim', () => {
  const r = resolveClaudeCommand(undefined, deps({ exe: ['C:/a/claude.exe', 'C:/b/claude.exe'], cmd: [SHIM] }));
  expect(r).toEqual({ argv: ['C:/a/claude.exe'], available: true });
});

test('windows: the shim package native exe is used when it exists', () => {
  const exe = join(PKG, 'bin', 'claude.exe');
  const r = resolveClaudeCommand(undefined, deps({ cmd: [SHIM], bin: { claude: 'bin/claude.exe' }, files: [exe] }));
  expect(r).toEqual({ argv: [exe], available: true });
  expect(resolveClaudeCommand(undefined, deps({ cmd: [SHIM], bin: 'bin/claude.exe', files: [exe] })).argv).toEqual([exe]);
});

test('windows: a missing or non-exe package bin falls back to the shim through cmd', () => {
  expect(resolveClaudeCommand(undefined, deps({ cmd: [SHIM], bin: { claude: 'bin/claude.exe' } })).argv).toEqual(['cmd.exe', '/c', SHIM]);
  expect(resolveClaudeCommand(undefined, deps({ cmd: [SHIM], bin: { claude: 'cli.js' }, files: [join(PKG, 'cli.js')] })).argv).toEqual(['cmd.exe', '/c', SHIM]);
  expect(resolveClaudeCommand(undefined, deps({ cmd: [SHIM] })).argv).toEqual(['cmd.exe', '/c', SHIM]);
});

test('windows: nothing found guesses claude.exe, unavailable; other platforms use claude', () => {
  expect(resolveClaudeCommand(undefined, deps({}))).toEqual({ argv: ['claude.exe'], available: false });
  expect(resolveClaudeCommand(undefined, deps({ platform: 'linux' }))).toEqual({ argv: ['claude'], available: true });
});

test('the resolution is cached and refilled by configure, claudeArgs are separate', () => {
  let calls = 0;
  const d = deps({ exe: ['C:/a/claude.exe'] });
  const c = createClaudeCommand({ ...d, where: (n) => (calls++, d.where(n)) });
  expect(c.argv()).toEqual(['C:/a/claude.exe']);
  c.argv();
  expect(calls).toBe(1);
  c.configure({ claudeCommand: 'D:/z.exe', claudeArgs: ['--x', 'a b'] });
  expect(c.argv()).toEqual(['D:/z.exe']);
  expect(c.extraArgs()).toEqual(['--x', 'a b']);
});

test('claudeEnv scrubs the enclosing session variables case-insensitively and sets COLORTERM', () => {
  const base: Record<string, string> = { PATH: 'p', Colorterm: 'no', claudecode: '1', Claude_Pid: '2', KEEP: 'k', CLAUDE_CONFIG_DIR: 'x' };
  for (const k of SCRUBBED_ENV) base[k] = 'v';
  const env = claudeEnv({ dir: '/h/.c', isDefault: true }, base);
  expect(env).toEqual({ PATH: 'p', KEEP: 'k', COLORTERM: 'truecolor' });
  expect(claudeEnv({ dir: '/h/.c', isDefault: false }, { CLAUDE_CODE_SSE_PORT: '1' })).toEqual({ COLORTERM: 'truecolor', CLAUDE_CONFIG_DIR: '/h/.c' });
});
