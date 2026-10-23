import type { TrackedPr } from '../github/tracked';
import type { Ticket } from './model';
import type { TicketLink } from './types';

export type AutoRule = 'open-pr' | 'ready-to-merge' | 'merged';

export const AUTO_RULES: Record<AutoRule, string> = {
  'open-pr': 'In Review',
  'ready-to-merge': 'Ready to Merge',
  merged: 'Done',
};

export const AUTO_BADGE_MS = 60 * 60 * 1000;

/** The rules a ticket's PRs trigger: closed unmerged PRs are ignored. */
export function ruleTriggers(prs: readonly TrackedPr[], readyLabel: string): AutoRule[] {
  const out: AutoRule[] = [];
  const open = prs.filter((p) => p.state === 'open');
  if (open.some((p) => !p.draft)) out.push('open-pr');
  const label = readyLabel.trim().toLowerCase();
  if (label && open.some((p) => p.labels.some((l) => l.toLowerCase().includes(label)))) out.push('ready-to-merge');
  if (open.length === 0 && prs.some((p) => p.state === 'merged')) out.push('merged');
  return out;
}

export interface AutoMove {
  id: string;
  status: string;
}

/**
 * Moves for tickets whose rules just fired: the target column must be right of the current one and the
 * current status on the board. The memory (rules seen per key) is updated for every ticket.
 */
export function planAutoMoves(
  tickets: readonly Ticket[],
  links: Record<string, TicketLink>,
  statuses: readonly string[],
  memory: Record<string, string[]>,
  defaultOn: boolean,
  readyLabel = 'ready to merge',
): { moves: AutoMove[]; memory: Record<string, string[]> } {
  const moves: AutoMove[] = [];
  const next: Record<string, string[]> = {};
  const lower = statuses.map((s) => s.toLowerCase());
  for (const t of tickets) {
    const link = links[t.key];
    const rules: AutoRule[] = link ? ruleTriggers(link.prs, readyLabel) : ((memory[t.key] ?? []) as AutoRule[]);
    next[t.key] = rules;
    if (!link) continue;
    if (!(t.autoMove ?? defaultOn)) continue;
    const seen = memory[t.key] ?? [];
    const current = lower.indexOf(t.status.toLowerCase());
    if (current < 0) continue;
    let best = -1;
    for (const rule of rules) {
      if (seen.includes(rule)) continue;
      const idx = lower.indexOf(AUTO_RULES[rule].toLowerCase());
      if (idx > current && idx > best) best = idx;
    }
    if (best >= 0) moves.push({ id: t.id, status: statuses[best]! });
  }
  return { moves, memory: next };
}
