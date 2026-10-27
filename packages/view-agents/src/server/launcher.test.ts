import { expect, test } from 'bun:test';
import { launchers } from '@kedalion/terminal/server';
import { claudeLauncher } from './launcher.ts';

const ID = '11111111-2222-3333-4444-555555555555';
const accounts = () => [
  { id: '.claude', dir: '/h/.claude', label: 'a', isDefault: true },
  { id: '.claude-work', dir: '/h/.claude-work', label: 'w', isDefault: false },
];
const reg = launchers({ claude: claudeLauncher({ accounts, env: { A: '1', CLAUDE_CONFIG_DIR: 'x' }, cmd: 'claude' }) });

test('new session uses --session-id and the account env', () => {
  const r = reg.resolve('claude', { account: '.claude-work', sessionId: ID }, { shell: ['sh'] })!;
  expect(r.cmd).toEqual(['claude', '--session-id', ID]);
  expect(r.env).toEqual({ A: '1', COLORTERM: 'truecolor', CLAUDE_CONFIG_DIR: '/h/.claude-work' });
  expect(r.meta.agentSession).toBe(ID);
});

test('resume on the default account drops CLAUDE_CONFIG_DIR', () => {
  const r = reg.resolve('claude', { account: '.claude', sessionId: ID, resume: true }, { shell: ['sh'] })!;
  expect(r.cmd).toEqual(['claude', '--resume', ID]);
  expect(r.env).toEqual({ A: '1', COLORTERM: 'truecolor' });
});

test('rejects unknown accounts and bad ids', () => {
  expect(reg.resolve('claude', { account: 'nope', sessionId: ID }, { shell: ['sh'] })).toBeNull();
  expect(reg.resolve('claude', { account: '.claude', sessionId: '--x' }, { shell: ['sh'] })).toBeNull();
});

test('mode comes before the user args and the prompt follows --', () => {
  const r = reg.resolve('claude', { account: '.claude', sessionId: ID, mode: 'plan', prompt: 'add a route' }, { shell: ['sh'] })!;
  expect(r.cmd).toEqual(['claude', '--session-id', ID, '--permission-mode', 'plan', '--', 'add a route']);
  expect(reg.resolve('claude', { account: '.claude', sessionId: ID, mode: 'bypass' }, { shell: ['sh'] })).toBeNull();
});
