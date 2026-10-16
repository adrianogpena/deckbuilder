import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { AgentAccount } from '../protocol.ts';

export type { AgentAccount };

function readEmail(file: string): string | undefined {
  try {
    const json = JSON.parse(readFileSync(file, 'utf8')) as { oauthAccount?: { emailAddress?: unknown } };
    const email = json?.oauthAccount?.emailAddress;
    return typeof email === 'string' && email ? email : undefined;
  } catch {
    return undefined;
  }
}

function isLoggedIn(dir: string): boolean {
  return (
    existsSync(join(dir, '.claude.json')) || existsSync(join(dir, '.credentials.json')) || existsSync(join(dir, 'projects'))
  );
}

/** `<home>/.claude` (default) plus every logged-in `<home>/.claude-*` dir. */
export function detectAccounts(home: string): AgentAccount[] {
  const out: AgentAccount[] = [];
  const def = join(home, '.claude');
  if (existsSync(def)) {
    const email = readEmail(join(home, '.claude.json'));
    out.push({ id: '.claude', dir: def, email, label: email ?? '.claude', isDefault: true });
  }
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
    if (!isLoggedIn(dir)) continue;
    const email = readEmail(join(dir, '.claude.json'));
    out.push({ id: basename(dir), dir, email, label: email ?? name, isDefault: false });
  }
  return out;
}
