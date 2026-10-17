import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsageReader, readUsageFile, usageContextPercent } from './usage';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = 1_700_000_000_000;

function write(account: string, id: string, data: unknown) {
  const p = join(dir, account);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, `${id}.json`), typeof data === 'string' ? data : JSON.stringify(data));
}

test('reads session usage and the newest rate limits per account', () => {
  dir = mkdtempSync(join(tmpdir(), 'usage-'));
  write('a', 's1', { updatedAt: NOW - 5000, sessionId: 's1', context_window: { used_percentage: 41.6 }, rate_limits: { five_hour: { used_percentage: 10, resets_at: NOW / 1000 + 3600 } } });
  write('a', 's2', { updatedAt: NOW - 1000, sessionId: 's2', rate_limits: { five_hour: { used_percentage: 30, resets_at: NOW / 1000 + 3600 }, seven_day: { used_percentage: 55, resets_at: NOW - 1 } } });
  write('a', 's3', { updatedAt: NOW, sessionId: 's3' });
  write('a', 'bad', '{not json');
  write('b', 's4', { updatedAt: NOW, sessionId: 's4' });
  const r = createUsageReader(() => dir, () => NOW).read([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]);
  expect([...r.bySession.keys()].sort()).toEqual(['s1', 's2', 's3', 's4']);
  expect(usageContextPercent(r.bySession.get('s1'))).toBe(42);
  expect(usageContextPercent(r.bySession.get('s3'))).toBeUndefined();
  expect(r.accounts).toEqual([{ account: 'a', label: 'A', updatedAt: NOW - 1000, fiveHour: { percent: 30, resetsAt: NOW + 3_600_000 }, sevenDay: { percent: 0 } }]);
});

test('readUsageFile rejects files that are not usage objects', () => {
  dir = mkdtempSync(join(tmpdir(), 'usage-'));
  write('a', 'x', { foo: 1 });
  expect(readUsageFile(join(dir, 'a', 'x.json'))).toBeNull();
  expect(readUsageFile(join(dir, 'a', 'missing.json'))).toBeNull();
});
