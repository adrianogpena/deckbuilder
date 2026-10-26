import { isRcComment } from './rc';

export const BOT_LOGIN = 'sofico-actions-bot[bot]';

export interface BotComment {
  body: string;
  updatedAt: string;
  url: string;
  rc?: boolean;
}

export interface BotEntry {
  source: string;
  updatedAt: string;
  url: string;
  lines: string[];
}

const ALERT = /^>\s*\[!(WARNING|CAUTION|IMPORTANT)\]/i;
const FAIL = /❌|:x:|failed|missing|incorrect|not found/i;

const stripHtml = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-z][^>]*>/gi, '');

/** Plain text of one markdown line: links keep their text, emphasis and code marks go. */
export function plain(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/:x:/g, '❌')
    .replace(/:warning:/g, '⚠️')
    .replace(/[*_`]+/g, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceLabel(body: string): string {
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const h = lines.find((l) => /^#{1,6}\s+\S/.test(l));
  const text = plain((h ?? lines.find((l) => l && !l.startsWith('>') && !l.startsWith('|')) ?? '').replace(/^#+\s*/, ''));
  return text || BOT_LOGIN;
}

export function parseBotWarnings(body: string, alertsOnly = false): string[] {
  const out: string[] = [];
  let inAlert = false;
  for (const raw of stripHtml(body).split(/\r?\n/)) {
    const l = raw.trim();
    if (ALERT.test(l)) {
      inAlert = true;
      continue;
    }
    if (inAlert && l.startsWith('>')) {
      const t = plain(l.replace(/^>\s?/, ''));
      if (t) out.push(t);
      continue;
    }
    inAlert = false;
    if (alertsOnly || !l || l.startsWith('#') || l.startsWith('>') || l.startsWith('|') || /^[-:\s|]+$/.test(l)) continue;
    if (FAIL.test(l)) {
      const t = plain(l);
      if (t) out.push(t);
    }
  }
  return [...new Set(out)];
}

/** One entry per bot comment that has warnings; of the RC comments only the latest is kept. */
export function parseBotComments(comments: readonly BotComment[]): BotEntry[] {
  let lastRc = -1;
  comments.forEach((c, i) => {
    if (c.rc ?? isRcComment(c.body)) lastRc = i;
  });
  const entries: BotEntry[] = [];
  comments.forEach((c, i) => {
    const rc = c.rc ?? isRcComment(c.body);
    if (rc && i !== lastRc) return;
    const lines = parseBotWarnings(c.body, rc);
    if (lines.length) entries.push({ source: sourceLabel(stripHtml(c.body)), updatedAt: c.updatedAt, url: c.url, lines });
  });
  return entries;
}
