import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentAccount } from '../protocol.ts';

export type { AgentAccount };

function readEmail(file: string): string | undefined {
  try {
    const json = JSON.parse(readFileSync(file, 'utf8')) as { oauthAccount?: { emailAddress?: unknown } };
    const email = json?.oauthAccount?.emailAddress;
    return typeof email === 'string' && email.trim() ? email.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The default account `<home>/.claude` (always first, even logged out), then every `<home>/.claude-*` directory whose own
 * `.claude.json` has an OAuth account email, sorted by folder name. `known` (config dir -> email) keeps an email that cannot be read now.
 */
export function detectAccounts(home: string, known?: ReadonlyMap<string, string>): AgentAccount[] {
  const def = join(home, '.claude');
  const defEmail = readEmail(join(def, '.claude.json')) ?? readEmail(join(home, '.claude.json')) ?? known?.get(def);
  const out: AgentAccount[] = [{ id: '.claude', dir: def, email: defEmail, label: defEmail ?? def, isDefault: true }];
  let names: string[] = [];
  try {
    names = readdirSync(home, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('.claude-'))
      .map((e) => e.name)
      .sort();
  } catch {
    /* home unreadable */
  }
  for (const name of names) {
    const dir = join(home, name);
    const email = readEmail(join(dir, '.claude.json')) ?? known?.get(dir);
    if (email) out.push({ id: name, dir, email, label: email, isDefault: false });
    else if (pendingDirs.has(normDir(dir))) out.push({ id: name, dir, label: name, isDefault: false });
  }
  return out;
}

/** Account dirs created by Add account: listed without an email until `/login` writes one. */
const pendingDirs = new Set<string>();
export const markPendingAccount = (dir: string) => void pendingDirs.add(normDir(dir));
export const forgetPendingAccount = (dir: string) => void pendingDirs.delete(normDir(dir));

/** Accounts of a home, rediscovered on every `list()`; an account stays listed with its last known email when it can no longer be read. */
export function createAccountRegistry(home: string) {
  const known = new Map<string, string>();
  return {
    list(): AgentAccount[] {
      const accounts = detectAccounts(home, known);
      for (const a of accounts) if (a.email) known.set(a.dir, a.email);
      return accounts;
    },
  };
}

const normDir = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const sameDir = (a: string, b: string) => normDir(a) === normDir(b);

/** The account with this config dir ("" = the default account). */
export const accountByDir = (accounts: AgentAccount[], dir: string): AgentAccount | undefined => (dir === '' ? accounts.find((a) => a.isDefault) : accounts.find((a) => sameDir(a.dir, dir)));

/** The active account: the one whose config dir is `activeDir` if known, else the default, else the first. */
export function resolveActiveAccount(accounts: AgentAccount[], activeDir?: string): AgentAccount | undefined {
  const match = activeDir ? accountByDir(accounts, activeDir) : undefined;
  return match ?? accounts.find((a) => a.isDefault) ?? accounts[0];
}

/** Short owner name: the email part before `@`, else the folder name. */
export const ownerName = (a: AgentAccount): string => (a.email ? a.email.split('@')[0]! : a.id);

/** Node suffix of a split project: email, folder name, or "default" for the default account without an email. */
export const accountNodeLabel = (a: AgentAccount): string => a.email ?? (a.isDefault ? 'default' : a.id);
