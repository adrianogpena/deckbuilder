import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentAccount } from '../protocol.ts';
import { createStatuslineInstaller } from './statusline-install.ts';

let root = '';
afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup(settings?: string) {
  root = mkdtempSync(join(tmpdir(), 'sl-install-'));
  const dir = join(root, '.claude-work');
  mkdirSync(dir);
  const file = join(dir, 'settings.json');
  if (settings !== undefined) writeFileSync(file, settings);
  const account: AgentAccount = { id: '.claude-work', dir, label: 'w', isDefault: false };
  const agentsDir = join(root, 'data', 'agents');
  let n = 0;
  const installer = createStatuslineInstaller({ agentsDir, execPath: '/bin/bun', now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)) });
  return { account, file, agentsDir, installer };
}

const backups = (file: string) => readdirSync(join(file, '..')).filter((f) => f.startsWith('settings.json.kedalion-') && f.endsWith('.bak'));

test('install keeps other keys and formatting, backs up, and chains the previous statusLine', () => {
  const original = '{\r\n    "theme": "dark",\r\n    "statusLine": { "type": "command", "command": "my-line", "padding": 2 },\r\n    "env": { "A": "1" }\r\n}\r\n';
  const { account, file, agentsDir, installer } = setup(original);
  const res = installer.install(account);
  expect(res.ok && res.status).toMatchObject({ installed: true, previous: 'my-line', settingsOk: true });
  const written = readFileSync(file, 'utf8');
  expect(written).toContain('\r\n    "theme": "dark"');
  expect(written.endsWith('}\r\n')).toBe(true);
  const json = JSON.parse(written);
  expect(Object.keys(json)).toEqual(['theme', 'statusLine', 'env']);
  expect(json.env).toEqual({ A: '1' });
  expect(json.statusLine).toMatchObject({ type: 'command', padding: 2 });
  expect(json.statusLine.command).toContain('statusline.');
  expect(json.statusLine.command.endsWith(' .claude-work')).toBe(true);
  expect(backups(file)).toHaveLength(1);
  expect(readFileSync(join(file, '..', backups(file)[0]!), 'utf8')).toBe(original);
  const state = JSON.parse(readFileSync(join(agentsDir, 'statusline.json'), 'utf8'));
  expect(state['.claude-work'].previous).toEqual({ type: 'command', command: 'my-line', padding: 2 });
  expect(existsSync(join(agentsDir, 'statusline.mjs'))).toBe(true);
});

test('uninstall restores the previous statusLine', () => {
  const original = '{\n  "statusLine": { "type": "command", "command": "my-line" },\n  "x": 1\n}\n';
  const { account, file, installer } = setup(original);
  installer.install(account);
  const res = installer.uninstall(account);
  expect(res.ok && res.status.installed).toBe(false);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ statusLine: { type: 'command', command: 'my-line' }, x: 1 });
  expect(backups(file)).toHaveLength(2);
  expect(installer.statuses([account])[0]).toMatchObject({ installed: false, previous: undefined });
});

test('without a previous statusLine uninstall removes the key; a missing settings.json is created', () => {
  const { account, file, installer } = setup();
  expect(installer.install(account).ok).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8')).statusLine.type).toBe('command');
  expect(backups(file)).toHaveLength(0);
  installer.uninstall(account);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({});
});

test('install twice keeps the first previous; uninstall leaves a statusLine the user changed since', () => {
  const { account, file, installer } = setup('{"statusLine":{"type":"command","command":"keep"}}');
  installer.install(account);
  installer.install(account);
  expect(installer.statuses([account])[0]).toMatchObject({ installed: true, previous: 'keep' });
  expect(backups(file)).toHaveLength(1);
  writeFileSync(file, '{"statusLine":{"type":"command","command":"newer"}}');
  const res = installer.uninstall(account);
  expect(res.ok).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8')).statusLine.command).toBe('newer');
  expect(backups(file)).toHaveLength(1);
});

test('an unparsable settings.json is refused and left untouched', () => {
  const { account, file, installer } = setup('{ nope');
  expect(installer.install(account)).toEqual({ ok: false, error: 'invalidSettings' });
  expect(readFileSync(file, 'utf8')).toBe('{ nope');
  expect(backups(file)).toHaveLength(0);
  expect(installer.statuses([account])[0]).toMatchObject({ installed: false, settingsOk: false });
});
