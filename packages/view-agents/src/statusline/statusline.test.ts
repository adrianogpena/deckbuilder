import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATUSLINE_SCRIPT_FILE, statuslineWrapper, writeStatuslineFiles } from './index.ts';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sample = {
  session_id: 'sess-1',
  model: { id: 'claude-opus', display_name: 'Opus' },
  context_window: { used_percentage: 42, context_window_size: 200000 },
  rate_limits: { five_hour: { used_percentage: 12, resets_at: 1 }, seven_day: { used_percentage: 3, resets_at: 2 } },
  cwd: 'C:/secret',
};

function setup(previous: object | null) {
  dir = mkdtempSync(join(tmpdir(), 'statusline-'));
  writeStatuslineFiles(dir, process.execPath);
  const prev = join(dir, 'prev.mjs');
  writeFileSync(prev, "let s = '';\nprocess.stdin.on('data', (d) => (s += d)).on('end', () => process.stdout.write('prev:' + s));\n");
  const command = `"${process.execPath.replace(/\\/g, '/')}" "${prev.replace(/\\/g, '/')}"`;
  writeFileSync(join(dir, 'statusline.json'), JSON.stringify({ '.claude-work': { command: 'x', previous: previous === null ? null : { type: 'command', command } } }));
}

const run = (stdin: string, account = '.claude-work') =>
  Bun.spawnSync({ cmd: [process.execPath, join(dir, STATUSLINE_SCRIPT_FILE), account], stdin: Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe' });

test('stores the usage fields and chains the previous command with the same stdin', () => {
  setup({});
  const raw = JSON.stringify(sample);
  const res = run(raw);
  expect(res.exitCode).toBe(0);
  expect(res.stdout.toString()).toBe(`prev:${raw}`);
  const stored = JSON.parse(readFileSync(join(dir, 'usage', '.claude-work', 'sess-1.json'), 'utf8'));
  expect(stored).toMatchObject({ sessionId: 'sess-1', model: sample.model, context_window: sample.context_window, rate_limits: sample.rate_limits });
  expect(typeof stored.updatedAt).toBe('number');
  expect(stored.cwd).toBeUndefined();
});

test('without rate limits only the other fields are stored', () => {
  setup(null);
  const res = run(JSON.stringify({ session_id: 's2', model: { id: 'm' } }));
  expect(res.exitCode).toBe(0);
  expect(res.stdout.toString()).toBe('');
  const stored = JSON.parse(readFileSync(join(dir, 'usage', '.claude-work', 's2.json'), 'utf8'));
  expect('rate_limits' in stored).toBe(false);
  expect(stored.model).toEqual({ id: 'm' });
});

test('unparsable stdin writes nothing but still chains and exits 0', () => {
  setup({});
  const res = run('not json');
  expect(res.exitCode).toBe(0);
  expect(res.stdout.toString()).toBe('prev:not json');
  expect(existsSync(join(dir, 'usage'))).toBe(false);
});

test('session ids cannot escape the usage folder', () => {
  setup(null);
  run(JSON.stringify({ session_id: '../../evil' }));
  expect(readdirSync(join(dir, 'usage', '.claude-work'))).toEqual(['.._.._evil.json']);
});

test('launcher runs the script with the given runtime', () => {
  expect(statuslineWrapper('C:\\app\\kedalion.exe', 'win32')).toBe('@echo off\r\nset BUN_BE_BUN=1\r\n"C:\\app\\kedalion.exe" "%~dp0statusline.mjs" %*\r\n');
  expect(statuslineWrapper('/opt/db', 'linux')).toContain('BUN_BE_BUN=1 exec "/opt/db"');
});

test('merges records: 1-decimal context, startup context kept, model/effort latest, rate limits never erased', () => {
  setup(null);
  const file = join(dir, 'usage', '.claude-work', 'm1.json');
  run(JSON.stringify({ session_id: 'm1', model: { display_name: 'Opus' }, effort: 'high', context_window: { used_percentage: 0 }, rate_limits: { five_hour: { used_percentage: 5, resets_at: 9 } } }));
  run(JSON.stringify({ session_id: 'm1', model: { display_name: 'Sonnet' }, effort: { level: 'low' }, context_window: { used_percentage: 0.94 } }));
  const mid = JSON.parse(readFileSync(file, 'utf8'));
  expect(mid.startupContextPercent).toBe(0.9);
  expect(mid.context_window.used_percentage).toBe(0.9);
  expect(mid.model.display_name).toBe('Sonnet');
  expect(mid.effort).toBe('low');
  expect(mid.rate_limits.five_hour).toEqual({ used_percentage: 5, resets_at: 9 });
  run(JSON.stringify({ session_id: 'm1', context_window: { used_percentage: 33.33 } }));
  const last = JSON.parse(readFileSync(file, 'utf8'));
  expect(last.startupContextPercent).toBe(0.9);
  expect(last.context_window.used_percentage).toBe(33.3);
  expect(last.model.display_name).toBe('Sonnet');
});

test('prints the cwd and context when there is no previous command', () => {
  setup(null);
  expect(run(JSON.stringify({ session_id: 'p1', cwd: '/w/app', context_window: { used_percentage: 41.6 } })).stdout.toString()).toBe('/w/app · ctx 42%');
  expect(run(JSON.stringify({ session_id: 'p2', cwd: '/w/app' })).stdout.toString()).toBe('/w/app');
  expect(run(JSON.stringify({ session_id: 'p3' })).stdout.toString()).toBe('');
});
