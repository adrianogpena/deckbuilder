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
  expect(statuslineWrapper('C:\\app\\deckbuilder.exe', 'win32')).toBe('@echo off\r\nset BUN_BE_BUN=1\r\n"C:\\app\\deckbuilder.exe" "%~dp0statusline.mjs" %*\r\n');
  expect(statuslineWrapper('/opt/db', 'linux')).toContain('BUN_BE_BUN=1 exec "/opt/db"');
});
