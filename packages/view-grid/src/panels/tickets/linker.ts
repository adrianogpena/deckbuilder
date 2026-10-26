import { DEFAULT_TICKET_PATTERN, ticketKey } from '../github/map';
import type { TrackedPr } from '../github/tracked';
import type { Pod } from '../pods/model';
import { normPodId, podId } from './model';
import type { Stage, TicketLink, UnlinkedKey } from './types';

/** The first key anywhere in a pod name, upper-cased; '' when none. */
export function podKey(name: string, pattern: string): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern || DEFAULT_TICKET_PATTERN);
  } catch {
    re = new RegExp(DEFAULT_TICKET_PATTERN);
  }
  const text = name.toUpperCase();
  const m = re.exec(text);
  return m ? m[0] : '';
}

export function prStage(prs: readonly TrackedPr[]): Stage {
  if (!prs.length) return 'none';
  const open = prs.filter((p) => p.state === 'open');
  if (!open.length) return prs.some((p) => p.state === 'merged') ? 'ok' : 'warn';
  let worst: Stage = 'ok';
  for (const p of open) {
    if (p.changesRequested || p.checks.state === 'failed') return 'fail';
    const review = p.reviewDecision;
    if (p.draft || p.checks.state === 'pending' || (review !== null && review !== 'APPROVED')) worst = 'pending';
  }
  return worst;
}

export function podsStage(pods: readonly Pod[]): Stage {
  if (!pods.length) return 'none';
  const healthy = pods.filter((p) => p.healthy).length;
  return healthy === pods.length ? 'ok' : healthy === 0 ? 'fail' : 'warn';
}

export interface LinkResult {
  links: Record<string, TicketLink>;
  unlinked: UnlinkedKey[];
}

/** Links the ticket keys to the PRs and pods that carry the same (upper-cased) key. */
export function linkTickets(
  keys: readonly string[],
  prs: readonly TrackedPr[],
  pods: readonly Pod[],
  pattern: string,
  manualPods: Record<string, readonly string[]> = {},
  aliases: Record<string, readonly string[]> = {},
): LinkResult {
  const prsBy = new Map<string, TrackedPr[]>();
  for (const pr of prs) {
    const key = ticketKey(pr.title, pr.branch.toUpperCase(), pattern).toUpperCase();
    if (key) prsBy.set(key, [...(prsBy.get(key) ?? []), pr]);
  }
  const podsBy = new Map<string, Pod[]>();
  for (const pod of pods) {
    const key = podKey(pod.name, pattern);
    if (key) podsBy.set(key, [...(podsBy.get(key) ?? []), pod]);
  }

  const links: Record<string, TicketLink> = {};
  const known = new Set<string>();
  for (const key of keys) {
    const up = key.toUpperCase();
    const own = [up, ...(aliases[key] ?? []).map((a) => a.toUpperCase())];
    for (const k of own) known.add(k);
    const linkedPrs = [...new Set(own.flatMap((k) => prsBy.get(k) ?? []))];
    const manual = new Set((manualPods[key] ?? manualPods[up] ?? []).map(normPodId));
    const auto = [...new Set(own.flatMap((k) => podsBy.get(k) ?? []))];
    const linkedPods = [...auto, ...pods.filter((p) => manual.has(podId(p)) && !auto.includes(p))];
    const branches = [...new Set(linkedPrs.map((p) => p.branch).filter(Boolean))];
    links[key] = {
      stages: { branch: branches.length ? 'ok' : 'none', pr: prStage(linkedPrs), pods: podsStage(linkedPods) },
      branches,
      prs: linkedPrs,
      pods: linkedPods,
      manualPods: [...manual],
    };
  }

  const unlinked: UnlinkedKey[] = [];
  const manualIds = new Set(Object.values(manualPods).flat().map(normPodId));
  for (const key of new Set([...prsBy.keys(), ...podsBy.keys()])) {
    if (known.has(key)) continue;
    const kp = prsBy.get(key) ?? [];
    const scopes = [...new Set(kp.map((p) => p.scope).filter((s): s is NonNullable<TrackedPr['scope']> => !!s))];
    unlinked.push({ key, scopes, prs: kp, pods: (podsBy.get(key) ?? []).filter((p) => !manualIds.has(podId(p))) });
  }
  return { links, unlinked };
}
