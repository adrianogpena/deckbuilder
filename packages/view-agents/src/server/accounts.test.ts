import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountByDir, createAccountRegistry, detectAccounts, resolveActiveAccount } from './accounts';

let home = '';
afterEach(() => rmSync(home, { recursive: true, force: true }));

const login = (dir: string, email?: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.claude.json'), JSON.stringify(email ? { oauthAccount: { emailAddress: email } } : {}));
};

test('default is always first; only logged-in siblings with an email are accounts, sorted by folder', () => {
  home = mkdtempSync(join(tmpdir(), 'acc-'));
  login(join(home, '.claude-work'), 'w@x.com');
  login(join(home, '.claude-a'), 'a2@x.com');
  login(join(home, '.claude-noemail'));
  mkdirSync(join(home, '.claude-empty'));
  const accs = detectAccounts(home);
  expect(accs.map((a) => a.id)).toEqual(['.claude', '.claude-a', '.claude-work']);
  expect(accs[0]).toMatchObject({ email: undefined, label: join(home, '.claude'), isDefault: true });
  expect(accs[2]).toMatchObject({ email: 'w@x.com', label: 'w@x.com', isDefault: false });
  login(join(home, '.claude'), 'd@x.com');
  expect(detectAccounts(home)[0]).toMatchObject({ email: 'd@x.com', label: 'd@x.com' });
});

test('registry rediscovers, updates emails and keeps a known one that cannot be read', () => {
  home = mkdtempSync(join(tmpdir(), 'acc-'));
  const reg = createAccountRegistry(home);
  expect(reg.list()).toHaveLength(1);
  login(join(home, '.claude-work'), 'w@x.com');
  expect(reg.list().map((a) => a.email)).toEqual([undefined, 'w@x.com']);
  writeFileSync(join(home, '.claude-work', '.claude.json'), 'not json');
  expect(reg.list()[1]).toMatchObject({ email: 'w@x.com', label: 'w@x.com' });
  login(join(home, '.claude-work'), 'new@x.com');
  expect(reg.list()[1]!.email).toBe('new@x.com');
});

test('active account: matching dir, else default, else first', () => {
  home = mkdtempSync(join(tmpdir(), 'acc-'));
  login(join(home, '.claude-work'), 'w@x.com');
  const accs = detectAccounts(home);
  expect(resolveActiveAccount(accs, join(home, '.claude-work'))?.id).toBe('.claude-work');
  expect(resolveActiveAccount(accs, '')?.id).toBe('.claude');
  expect(resolveActiveAccount(accs, join(home, '.claude-gone'))?.id).toBe('.claude');
  expect(resolveActiveAccount(accs.slice(1), join(home, '.claude-gone'))?.id).toBe('.claude-work');
  expect(resolveActiveAccount([], 'x')).toBeUndefined();
  expect(accountByDir(accs, '')?.isDefault).toBe(true);
  expect(accountByDir(accs, join(home, '.claude-nope'))).toBeUndefined();
});
