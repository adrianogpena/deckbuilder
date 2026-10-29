import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { runCli } from '../../cli';
import {
  buildDays, collapseCopilotWorktree, copilotRecords, createClaudeScan, encodeRoot, IDLE_MINUTES, isTracked, knownPrefixes,
  makeTicketFinder, parseDay, parseSimpleYaml, resolveSession, weekBounds, type ClaudeSession, type Commit, type DayTable, type Rec,
} from './analysis';

export interface CollectOptions {
  roots: string[];
  ticketPattern: string;
  includeCopilot: boolean;
  includeGit: boolean;
  /** Commit author emails, comma or space separated; empty uses each repo's `user.email`. */
  gitEmail?: string;
  /** Longest gap between two records that still counts as work. */
  idleMinutes?: number;
  claudeDir?: string;
  copilotDir?: string;
  now?: Date;
  signal?: AbortSignal;
}

export const CLAUDE_DIR = join(homedir(), '.claude', 'projects');
export const COPILOT_DIR = join(homedir(), '.copilot', 'session-state');

async function* linesOf(file: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
  }
}

const safeDir = (dir: string): Promise<string[]> => readdir(dir).catch(() => []);

async function git(args: string[], signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await runCli(['git', ...args], { timeoutMs: 15_000, signal });
    return res.code === 0 ? res.stdout : null;
  } catch {
    return null;
  }
}

/** `--author` takes a regular expression. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Author filters for one repo: the configured emails, or the repo's own `user.email`; none when neither is set. */
async function authorArgs(repo: string, emails: string[], signal?: AbortSignal): Promise<string[]> {
  const list = emails.length ? emails : [(await git(['-C', repo, 'config', 'user.email'], signal))?.trim() ?? ''].filter(Boolean);
  return list.map((e) => `--author=${escapeRe(e)}`);
}

/** The week's hours and commits per day and ticket, read from the session folders and git; nothing is written. */
export async function collectWeek(opts: CollectOptions): Promise<DayTable> {
  const bounds = weekBounds(opts.now ?? new Date());
  const monday = bounds.monday;
  const friday = bounds.days[4] as string;
  const mondayMs = parseDay(monday).getTime();
  const inWeek = (day: string) => day >= monday && day <= friday;
  const roots = opts.roots;
  const findTicket = makeTicketFinder(opts.ticketPattern);
  const idleMs = (opts.idleMinutes ?? IDLE_MINUTES) * 60_000;
  const records: Rec[] = [];
  const sessions: ClaudeSession[] = [];
  const repoCwds = new Set<string>();
  if (roots.length === 0) return buildDays([], [], bounds.days, idleMs);

  const claudeDir = opts.claudeDir ?? CLAUDE_DIR;
  const prefixes = roots.map(encodeRoot);
  for (const name of await safeDir(claudeDir)) {
    if (!prefixes.some((p) => name.toUpperCase().startsWith(p))) continue;
    const dir = join(claudeDir, name);
    for (const file of await safeDir(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const full = join(dir, file);
      try {
        if ((await stat(full)).mtimeMs < mondayMs) continue;
        const scan = createClaudeScan(roots, findTicket, inWeek);
        for await (const line of linesOf(full)) scan.feed(line);
        const subagents = join(dir, file.slice(0, -'.jsonl'.length), 'subagents');
        for (const sub of await safeDir(subagents)) {
          if (sub.endsWith('.jsonl')) for await (const line of linesOf(join(subagents, sub))) scan.feed(line);
        }
        const session = scan.result();
        if (session.records.length && session.cwd) {
          sessions.push(session);
          repoCwds.add(session.cwd);
        }
      } catch {}
    }
  }

  if (opts.includeCopilot) {
    const copilotDir = opts.copilotDir ?? COPILOT_DIR;
    for (const name of await safeDir(copilotDir)) {
      const dir = join(copilotDir, name);
      try {
        const ws = parseSimpleYaml(await readFile(join(dir, 'workspace.yaml'), 'utf8'));
        if (!ws.cwd || !isTracked(ws.cwd, roots)) continue;
        const updated = ws.updated_at ? new Date(ws.updated_at).getTime() : Number.NaN;
        if (!Number.isNaN(updated) && updated < mondayMs) continue;
        const ticket = findTicket(ws.branch) ?? findTicket(ws.name) ?? findTicket(ws.summary);
        const found: Rec[] = [];
        for await (const line of linesOf(join(dir, 'events.jsonl'))) found.push(...copilotRecords([line], ticket, inWeek));
        if (found.length) {
          records.push(...found);
          repoCwds.add(collapseCopilotWorktree(ws.cwd));
        }
      } catch {}
    }
  }

  const commits: Commit[] = [];
  if (opts.includeGit && (records.length || sessions.length)) {
    const emails = (opts.gitEmail ?? '').split(/[\s,]+/).filter(Boolean);
    const tops = new Set<string>();
    for (const cwd of repoCwds) {
      const top = (await git(['-C', cwd, 'rev-parse', '--show-toplevel'], opts.signal))?.trim();
      tops.add(top || cwd);
    }
    for (const repo of tops) {
      const out = await git(
        ['-C', repo, 'log', '--all', ...(await authorArgs(repo, emails, opts.signal)), `--since=${monday} 00:00`, `--until=${friday} 23:59`, '--pretty=format:%ad|%s', '--date=format-local:%Y-%m-%d'],
        opts.signal,
      );
      if (!out) continue;
      for (const line of out.split('\n')) {
        const idx = line.indexOf('|');
        if (idx > 0) commits.push({ day: line.slice(0, idx), ticket: findTicket(line.slice(idx + 1)) });
      }
    }
  }
  const known = knownPrefixes(sessions, commits);
  for (const s of sessions) records.push(...resolveSession(s, known));
  return buildDays(records, commits, bounds.days, idleMs);
}

