import type { AgentsMessageKey } from '../i18n';
import type { AgentSessionView } from '../protocol';

/** The view's `t`; passed in so this module (and its test) does not load `../i18n`. */
export type StatusT = (key: AgentsMessageKey, params?: Record<string, string | number>) => string;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Short elapsed time: "just now", "{n} min", "{n} h", "{n} d". */
export function elapsedText(ms: number, t: StatusT): string {
  if (ms < MIN) return t('agents.since.justNow');
  if (ms < HOUR) return t('agents.since.min', { n: Math.floor(ms / MIN) });
  if (ms < DAY) return t('agents.since.h', { n: Math.floor(ms / HOUR) });
  return t('agents.since.d', { n: Math.floor(ms / DAY) });
}

/** Status label and time in that status, for dot tooltips: `text` = "Waiting for you · 2 min". */
export function statusSince(session: Pick<AgentSessionView, 'status' | 'statusSince' | 'updatedAt'>, now: number, t: StatusT): { label: string; since: string; text: string } {
  const label = t(`agents.since.status.${session.status}`);
  const since = elapsedText(Math.max(0, now - (session.statusSince ?? session.updatedAt)), t);
  return { label, since, text: `${label} · ${since}` };
}
