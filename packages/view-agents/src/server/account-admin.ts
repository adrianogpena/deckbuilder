import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_SHARE_ENTRIES, type AgentAccountAdminError, type AgentShareEntry, type AgentShareReport } from '../protocol.ts';

/** Default account folder name: never edited or deleted. */
const DEFAULT_FOLDER = '.claude';

const isShareEntry = (x: unknown): x is AgentShareEntry => typeof x === 'string' && (AGENT_SHARE_ENTRIES as readonly string[]).includes(x);

/** Only known share entries, deduplicated. */
export const shareList = (raw: unknown): AgentShareEntry[] => (Array.isArray(raw) ? [...new Set(raw.filter(isShareEntry))] : []);

/** `personal`, `claude-personal` and `.claude-personal` all mean `.claude-personal`; undefined when not a plain folder name. */
export function normalizeName(raw: string): string | undefined {
  let n = raw.trim().replace(/^\.+/, '');
  if (n.toLowerCase().startsWith('claude-')) n = n.slice('claude-'.length);
  if (!n || /[/\\:]/.test(n) || n.includes('..')) return undefined;
  return `.claude-${n}`;
}

/** A `.claude-<name>` folder name directly in home (never `.claude`, no separators). */
const isAccountFolder = (folder: unknown): folder is string => typeof folder === 'string' && normalizeName(folder) === folder;

const lstatOf = (p: string) => {
  try {
    return lstatSync(p);
  } catch {
    return undefined;
  }
};

const isLink = (p: string) => !!lstatOf(p)?.isSymbolicLink();

/** Removes the link itself, never what it points to (a junction is unlinked or rmdir'd, never removed recursively). */
function removeLink(p: string) {
  try {
    unlinkSync(p);
  } catch {
    rmdirSync(p);
  }
}

/** Links `path` to `target`: a junction for folders, a symlink for files ('devMode' when Windows refuses it). */
function link(target: string, path: string): 'linked' | 'devMode' {
  if (statSync(target).isDirectory()) {
    symlinkSync(target, path, 'junction');
    return 'linked';
  }
  try {
    symlinkSync(target, path, 'file');
    return 'linked';
  } catch {
    return 'devMode';
  }
}

const emptyReport = (): AgentShareReport => ({ linked: 0, unlinked: 0, skipped: 0, skippedDevMode: 0 });

/** Links one entry to the default account's (skipped if missing there or something already exists). */
function linkEntry(home: string, dir: string, entry: AgentShareEntry, r: AgentShareReport) {
  const target = join(home, DEFAULT_FOLDER, entry);
  const path = join(dir, entry);
  if (!existsSync(target) || lstatOf(path)) return void r.skipped++;
  if (link(target, path) === 'linked') r.linked++;
  else r.skippedDevMode++;
}

export type AddAccountResult = ({ ok: true; folder: string; dir: string } & AgentShareReport) | { ok: false; error: AgentAccountAdminError };

/** Creates `<home>/.claude-<name>`; each `share` entry becomes a link to the default account's entry. */
export function addAccount(home: string, name: string, share: AgentShareEntry[]): AddAccountResult {
  const folder = normalizeName(name);
  if (!folder) return { ok: false, error: 'invalidName' };
  const dir = join(home, folder);
  if (lstatOf(dir)) return { ok: false, error: 'exists' };
  try {
    mkdirSync(dir);
  } catch {
    return { ok: false, error: 'failed' };
  }
  const r = emptyReport();
  for (const entry of share) {
    try {
      linkEntry(home, dir, entry, r);
    } catch {
      r.skipped++;
    }
  }
  return { ok: true, folder, dir, ...r };
}

export type ReadSharedResult = { ok: true; shared: AgentShareEntry[] } | { ok: false; error: AgentAccountAdminError };

/** The entries of the account folder that are links now. */
export function readShared(home: string, folder: string): ReadSharedResult {
  if (!isAccountFolder(folder)) return { ok: false, error: folder === DEFAULT_FOLDER ? 'default' : 'invalidName' };
  const dir = join(home, folder);
  if (!lstatOf(dir)?.isDirectory()) return { ok: false, error: 'notFound' };
  return { ok: true, shared: AGENT_SHARE_ENTRIES.filter((e) => isLink(join(dir, e))) };
}

export type ApplySharedResult = ({ ok: true; folder: string } & AgentShareReport) | { ok: false; error: AgentAccountAdminError };

/** Links wanted entries that are missing, unlinks unwanted links; real files and folders are never touched (counted as skipped when wanted). */
export function applyShared(home: string, folder: string, share: AgentShareEntry[]): ApplySharedResult {
  if (!isAccountFolder(folder)) return { ok: false, error: folder === DEFAULT_FOLDER ? 'default' : 'invalidName' };
  const dir = join(home, folder);
  if (!lstatOf(dir)?.isDirectory()) return { ok: false, error: 'notFound' };
  const r = emptyReport();
  for (const entry of AGENT_SHARE_ENTRIES) {
    const path = join(dir, entry);
    const st = lstatOf(path);
    const wanted = share.includes(entry);
    try {
      if (st?.isSymbolicLink()) {
        if (!wanted) {
          removeLink(path);
          r.unlinked++;
        }
      } else if (wanted) linkEntry(home, dir, entry, r);
    } catch {
      r.skipped++;
    }
  }
  return { ok: true, folder, ...r };
}

/** Removes every link under `dir` (without following it), depth first. */
function removeLinks(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatOf(p);
    if (st?.isSymbolicLink()) removeLink(p);
    else if (st?.isDirectory()) removeLinks(p);
  }
}

export type DeleteAccountResult = { ok: true; folder: string; dir: string } | { ok: false; error: AgentAccountAdminError };

/** Deletes `<home>/.claude-<name>`: links first (shared targets are never followed), then the folder. */
export function deleteAccount(home: string, folder: string): DeleteAccountResult {
  if (!isAccountFolder(folder)) return { ok: false, error: folder === DEFAULT_FOLDER ? 'default' : 'invalidName' };
  const dir = join(home, folder);
  const st = lstatOf(dir);
  if (!st) return { ok: false, error: 'notFound' };
  try {
    if (st.isSymbolicLink()) removeLink(dir);
    else {
      removeLinks(dir);
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    return { ok: false, error: 'failed' };
  }
  return { ok: true, folder, dir };
}
