import { summarizeChecks, type CheckDetail, type ContextNode } from './tracked';

export const DEFAULT_TICKET_PATTERN = '[A-Z][A-Z0-9]+-\\d+';
export const MIN_REFRESH_MS = 60_000;
export const PR_REFRESH_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 15 * 60_000;

export type SearchKind = 'pr' | 'issue';
export type CiState = 'pass' | 'fail' | 'pending' | 'none';

export const PR_MODES = ['mine', 'review', 'assigned', 'involves', 'closed', 'repo', 'custom'] as const;
export const ISSUE_MODES = ['assigned', 'created', 'mentioned', 'repo', 'custom'] as const;

const PR_QUERIES: Record<string, string> = {
  mine: 'is:pr is:open author:@me',
  review: 'is:pr is:open review-requested:@me',
  assigned: 'is:pr is:open assignee:@me',
  involves: 'is:pr is:open involves:@me',
  closed: 'is:pr is:closed author:@me sort:updated-desc',
};

const ISSUE_QUERIES: Record<string, string> = {
  assigned: 'is:issue is:open assignee:@me',
  created: 'is:issue is:open author:@me',
  mentioned: 'is:issue is:open mentions:@me',
};

/** The search string of a mode; null when the mode needs a repo or query that is empty. */
export function buildQuery(kind: SearchKind, mode: string, repo: string, query: string): string | null {
  const prefix = kind === 'pr' ? 'is:pr' : 'is:issue';
  if (mode === 'repo') return /^[\w.-]+\/[\w.-]+$/.test(repo.trim()) ? `${prefix} is:open repo:${repo.trim()}` : null;
  if (mode === 'custom') {
    const q = query.trim();
    if (!q) return null;
    return new RegExp(`(^|\\s)${prefix}(\\s|$)`).test(q) ? q : `${prefix} ${q}`;
  }
  return (kind === 'pr' ? PR_QUERIES : ISSUE_QUERIES)[mode] ?? null;
}

interface Rollup {
  state?: string;
  contexts?: { nodes?: (ContextNode | null)[] };
}

/** The checks of a rollup as detail rows: latest run per name, failures first. */
export function mapCheckList(rollup: Rollup | null | undefined): CheckDetail[] {
  return summarizeChecks((rollup?.contexts?.nodes ?? []).filter((n): n is ContextNode => !!n)).details;
}

const FAIL_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'STARTUP_FAILURE', 'ACTION_REQUIRED']);

/** statusCheckRollup -> pass/fail/pending plus the names of the failing checks. */
export function reduceChecks(rollup: Rollup | null | undefined): { state: CiState; failing: string[] } {
  if (!rollup?.state) return { state: 'none', failing: [] };
  const failing: string[] = [];
  for (const n of rollup.contexts?.nodes ?? []) {
    if (!n) continue;
    if (n.__typename === 'CheckRun') {
      if (n.conclusion && FAIL_CONCLUSIONS.has(n.conclusion)) failing.push(n.name ?? '');
    } else if (n.state === 'FAILURE' || n.state === 'ERROR') failing.push(n.context ?? '');
  }
  const names = failing.filter(Boolean);
  switch (rollup.state) {
    case 'SUCCESS':
      return { state: 'pass', failing: [] };
    case 'FAILURE':
    case 'ERROR':
      return { state: 'fail', failing: names };
    case 'PENDING':
    case 'EXPECTED':
      return { state: names.length ? 'fail' : 'pending', failing: names };
    default:
      return { state: 'none', failing: [] };
  }
}

export interface CheckCounts {
  passed: number;
  failed: number;
  pending: number;
  total: number;
}

/** The checks in a rollup (first 50 contexts) counted by outcome. */
export function countChecks(rollup: Rollup | null | undefined): CheckCounts {
  const c: CheckCounts = { passed: 0, failed: 0, pending: 0, total: 0 };
  for (const n of rollup?.contexts?.nodes ?? []) {
    if (!n) continue;
    c.total++;
    if (n.__typename === 'CheckRun') {
      if (!n.conclusion) c.pending++;
      else if (FAIL_CONCLUSIONS.has(n.conclusion)) c.failed++;
      else c.passed++;
    } else if (n.state === 'FAILURE' || n.state === 'ERROR') c.failed++;
    else if (n.state === 'PENDING' || n.state === 'EXPECTED') c.pending++;
    else c.passed++;
  }
  return c;
}

/** The first ticket key in the title, else in the branch; '' when none or the pattern is not a valid regex. */
export function ticketKey(title: string, branch: string, pattern: string): string {
  let re: RegExp;
  try {
    re = new RegExp(pattern || DEFAULT_TICKET_PATTERN);
  } catch {
    re = new RegExp(DEFAULT_TICKET_PATTERN);
  }
  return re.exec(title)?.[0] ?? re.exec(branch)?.[0] ?? '';
}

export interface RateLimit {
  remaining: number;
  limit: number;
}

/**
 * The suggested interval under rate pressure: below 10% remaining it doubles `prev` (or `base`), max 15 min;
 * undefined when the quota is fine.
 */
export function nextRefreshMs(rate: RateLimit | null | undefined, base: number, prev?: number): number | undefined {
  if (!rate || !(rate.limit > 0) || rate.remaining / rate.limit >= 0.1) return undefined;
  return Math.min(MAX_BACKOFF_MS, Math.max(base, prev ?? base) * 2);
}

interface Node {
  number?: number;
  title?: string;
  url?: string;
  state?: string;
  updatedAt?: string;
  author?: { login?: string } | null;
  repository?: { nameWithOwner?: string } | null;
  labels?: { nodes?: ({ name?: string } | null)[] } | null;
  isDraft?: boolean;
  headRefName?: string;
  reviewDecision?: string | null;
  commits?: { nodes?: ({ commit?: { statusCheckRollup?: Rollup | null } } | null)[] } | null;
  assignees?: { nodes?: ({ login?: string } | null)[] } | null;
  comments?: { totalCount?: number } | null;
  milestone?: { title?: string } | null;
  createdAt?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  mergeable?: string;
  baseRefName?: string;
  autoMergeRequest?: { enabledAt?: string } | null;
  reviewThreads?: { nodes?: ({ isResolved?: boolean } | null)[] } | null;
}

export interface SearchResponse {
  search?: { issueCount?: number; nodes?: (Node | null)[] };
  rateLimit?: { remaining?: number; limit?: number } | null;
}

export type Review = 'approved' | 'changes' | 'required' | 'none';

export interface PrItem {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  draft: boolean;
  state: string;
  branch: string;
  labels: string[];
  review: Review;
  ci: CiState;
  failing: string[];
  ticket: string;
  /** The ticket key is on the Tickets board (always true when the board could not be read). */
  linked: boolean;
  updatedAt: string;
  createdAt: string;
  additions: number;
  deletions: number;
  files: number;
  conflicts: boolean;
  threads: number;
  comments: number;
  base: string;
  autoMerge: boolean;
  checks: CheckCounts;
  checkList: CheckDetail[];
}

export interface IssueItem {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  state: string;
  labels: string[];
  assignees: string[];
  comments: number;
  milestone: string;
  updatedAt: string;
}

export interface SearchData<T> {
  total: number;
  items: T[];
  /** Suggested reload interval under rate pressure. */
  nextRefreshMs?: number;
}

const names = (list: { nodes?: ({ name?: string; login?: string } | null)[] } | null | undefined, key: 'name' | 'login'): string[] =>
  (list?.nodes ?? []).map((n) => n?.[key] ?? '').filter(Boolean);

const REVIEW: Record<string, Review> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'required' };

export function mapPullRequests(res: SearchResponse, ticketPattern: string): SearchData<PrItem> {
  const items: PrItem[] = [];
  for (const n of res.search?.nodes ?? []) {
    if (!n?.number || !n.url) continue;
    const checks = reduceChecks(n.commits?.nodes?.[0]?.commit?.statusCheckRollup);
    const title = n.title ?? '';
    const branch = n.headRefName ?? '';
    items.push({
      id: n.url,
      number: n.number,
      title,
      url: n.url,
      repo: n.repository?.nameWithOwner ?? '',
      author: n.author?.login ?? '',
      draft: n.isDraft === true,
      state: (n.state ?? '').toLowerCase(),
      branch,
      labels: names(n.labels, 'name'),
      review: REVIEW[n.reviewDecision ?? ''] ?? 'none',
      ci: checks.state,
      failing: checks.failing,
      ticket: ticketKey(title, branch, ticketPattern),
      linked: true,
      updatedAt: n.updatedAt ?? '',
      createdAt: n.createdAt ?? '',
      additions: n.additions ?? 0,
      deletions: n.deletions ?? 0,
      files: n.changedFiles ?? 0,
      conflicts: n.mergeable === 'CONFLICTING',
      threads: (n.reviewThreads?.nodes ?? []).filter((t) => t && t.isResolved === false).length,
      comments: n.comments?.totalCount ?? 0,
      base: n.baseRefName ?? '',
      autoMerge: !!n.autoMergeRequest?.enabledAt,
      checks: countChecks(n.commits?.nodes?.[0]?.commit?.statusCheckRollup),
      checkList: mapCheckList(n.commits?.nodes?.[0]?.commit?.statusCheckRollup),
    });
  }
  return { total: res.search?.issueCount ?? items.length, items };
}

export function mapIssues(res: SearchResponse): SearchData<IssueItem> {
  const items: IssueItem[] = [];
  for (const n of res.search?.nodes ?? []) {
    if (!n?.number || !n.url) continue;
    items.push({
      id: n.url,
      number: n.number,
      title: n.title ?? '',
      url: n.url,
      repo: n.repository?.nameWithOwner ?? '',
      author: n.author?.login ?? '',
      state: (n.state ?? '').toLowerCase(),
      labels: names(n.labels, 'name'),
      assignees: names(n.assignees, 'login'),
      comments: n.comments?.totalCount ?? 0,
      milestone: n.milestone?.title ?? '',
      updatedAt: n.updatedAt ?? '',
    });
  }
  return { total: res.search?.issueCount ?? items.length, items };
}

/** The reload interval of a search panel: `base`, 60 s while checks are pending, never below 60 s, never under the source's suggestion. */
export function searchRefreshMs(data: { nextRefreshMs?: number; items: readonly object[] } | undefined, base = PR_REFRESH_MS): number {
  const pending = data?.items.some((i) => (i as { ci?: CiState }).ci === 'pending') ? MIN_REFRESH_MS : base;
  return Math.max(MIN_REFRESH_MS, pending, data?.nextRefreshMs ?? 0);
}
