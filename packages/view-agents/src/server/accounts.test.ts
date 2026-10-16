import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAccounts } from './accounts';

let home = '';
afterEach(() => rmSync(home, { recursive: true, force: true }));

test('default and extra accounts, with and without email', () => {
  home = mkdtempSync(join(tmpdir(), 'acc-'));
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@x.com' }, other: 1 }));
  mkdirSync(join(home, '.claude-work'));
  writeFileSync(join(home, '.claude-work', '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'w@x.com' } }));
  mkdirSync(join(home, '.claude-noemail'));
  writeFileSync(join(home, '.claude-noemail', '.claude.json'), '{}');
  mkdirSync(join(home, '.claude-empty'));
  const accs = detectAccounts(home);
  expect(accs.map((a) => a.id)).toEqual(['.claude', '.claude-noemail', '.claude-work']);
  expect(accs[0]).toMatchObject({ email: 'a@x.com', label: 'a@x.com', isDefault: true });
  expect(accs[1]).toMatchObject({ email: undefined, label: '.claude-noemail' });
  expect(accs[2].email).toBe('w@x.com');
});
