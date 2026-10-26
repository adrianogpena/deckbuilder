export const RUN_COLUMNS = ['branch', 'event', 'actor', 'duration', 'updated'] as const;
export const NOTIFICATION_COLUMNS = ['repo', 'reason', 'type', 'updated'] as const;
export const OVERVIEW_STATS = ['stars', 'forks', 'issues', 'prs', 'watchers', 'push', 'ci'] as const;

export const RUNS_ACTIVE_REFRESH_MS = 60_000;
export const RUNS_IDLE_REFRESH_MS = 5 * 60_000;

export type RunStatus = 'success' | 'failure' | 'in_progress' | 'queued' | 'cancelled' | 'other';

export interface RunItem {
  id: string;
  title: string;
  workflow: string;
  url: string;
  status: RunStatus;
  branch: string;
  event: string;
  actor: string;
  durationMs: number;
  updatedAt: string;
}

export interface RunsData {
  items: RunItem[];
  nextRefreshMs?: number;
}

interface RawRun {
  id?: number;
  name?: string | null;
  display_title?: string | null;
  html_url?: string;
  status?: string | null;
  conclusion?: string | null;
  head_branch?: string | null;
  event?: string;
  actor?: { login?: string } | null;
  run_started_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function runStatus(status: string | null | undefined, conclusion: string | null | undefined): RunStatus {
  if (status === 'completed') {
    if (conclusion === 'success') return 'success';
    if (conclusion === 'cancelled') return 'cancelled';
    if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure') return 'failure';
    return 'other';
  }
  if (status === 'in_progress') return 'in_progress';
  if (status === 'queued' || status === 'waiting' || status === 'pending' || status === 'requested') return 'queued';
  return 'other';
}

export function mapRuns(raw: { workflow_runs?: RawRun[] }, max: number): RunsData {
  const items = (raw.workflow_runs ?? []).slice(0, max).map((r): RunItem => {
    const started = Date.parse(r.run_started_at ?? r.created_at ?? '');
    const updated = Date.parse(r.updated_at ?? '');
    return {
      id: String(r.id ?? ''),
      title: r.display_title || r.name || '',
      workflow: r.name ?? '',
      url: r.html_url ?? '',
      status: runStatus(r.status, r.conclusion),
      branch: r.head_branch ?? '',
      event: r.event ?? '',
      actor: r.actor?.login ?? '',
      durationMs: Number.isFinite(started) && Number.isFinite(updated) ? Math.max(0, updated - started) : 0,
      updatedAt: r.updated_at ?? '',
    };
  });
  return { items };
}

/** The newest finished run (success or failure) of each workflow, from runs listed newest first. */
export function latestSettledRuns(items: readonly RunItem[]): RunItem[] {
  const out = new Map<string, RunItem>();
  for (const r of items) {
    const key = r.workflow || r.title;
    if ((r.status === 'success' || r.status === 'failure') && !out.has(key)) out.set(key, r);
  }
  return [...out.values()];
}

/** 60 s while any run is queued or in progress, else 5 min. */
export function runsRefreshMs(data: RunsData | undefined): number {
  if (data?.nextRefreshMs) return data.nextRefreshMs;
  return data?.items.some((i) => i.status === 'in_progress' || i.status === 'queued') ? RUNS_ACTIVE_REFRESH_MS : RUNS_IDLE_REFRESH_MS;
}

/** `owner/name` or a trimmed variant; empty when it is not that shape. */
export function parseRepo(repo: string): string {
  const m = /^\s*([\w.-]+)\/([\w.-]+)\s*$/.exec(repo);
  return m ? `${m[1]}/${m[2]}` : '';
}

/** The REST path of the runs of a repo, optionally of one workflow file and branch. */
export function runsPath(repo: string, branch: string, workflow: string, max: number): string {
  const base = workflow.trim() ? `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow.trim())}/runs` : `/repos/${repo}/actions/runs`;
  const q = new URLSearchParams({ per_page: String(max) });
  if (branch.trim()) q.set('branch', branch.trim());
  return `${base}?${q}`;
}

/** Subject API URL of a notification to its html page; unknown shapes go to the repo page. */
export function subjectHtmlUrl(apiUrl: string | null | undefined, repoHtmlUrl = ''): string {
  if (!apiUrl) return repoHtmlUrl;
  let u: URL;
  try {
    u = new URL(apiUrl);
  } catch {
    return repoHtmlUrl;
  }
  const host = u.host === 'api.github.com' ? 'github.com' : u.host;
  const path = u.pathname.replace(/^\/api\/v3(?=\/)/, '');
  const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/(pulls|issues)\/(\d+))?/.exec(path);
  if (!m) return repoHtmlUrl;
  const repoUrl = `${u.protocol}//${host}/${m[1]}/${m[2]}`;
  if (m[3] && m[4]) return `${repoUrl}/${m[3] === 'pulls' ? 'pull' : 'issues'}/${m[4]}`;
  return repoUrl;
}

export interface NotificationItem {
  id: string;
  title: string;
  url: string;
  repo: string;
  reason: string;
  type: string;
  updatedAt: string;
}

interface RawNotification {
  id?: string;
  reason?: string;
  updated_at?: string;
  subject?: { title?: string; url?: string | null; type?: string };
  repository?: { full_name?: string; html_url?: string };
}

export function mapNotifications(raw: RawNotification[], max: number): { items: NotificationItem[] } {
  return {
    items: (Array.isArray(raw) ? raw : []).slice(0, max).map((n) => ({
      id: n.id ?? '',
      title: n.subject?.title ?? '',
      url: subjectHtmlUrl(n.subject?.url, n.repository?.html_url),
      repo: n.repository?.full_name ?? '',
      reason: n.reason ?? '',
      type: n.subject?.type ?? '',
      updatedAt: n.updated_at ?? '',
    })),
  };
}

export interface ReleaseItem {
  id: string;
  tag: string;
  name: string;
  url: string;
  prerelease: boolean;
  publishedAt: string;
}

interface RawRelease {
  id?: number;
  tag_name?: string;
  name?: string | null;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
  published_at?: string | null;
  created_at?: string;
}

export function mapReleases(raw: RawRelease[], max: number, includePrereleases: boolean): { items: ReleaseItem[] } {
  const items = (Array.isArray(raw) ? raw : [])
    .filter((r) => !r.draft && (includePrereleases || !r.prerelease))
    .slice(0, max)
    .map((r): ReleaseItem => ({
      id: String(r.id ?? r.tag_name ?? ''),
      tag: r.tag_name ?? '',
      name: r.name || r.tag_name || '',
      url: r.html_url ?? '',
      prerelease: !!r.prerelease,
      publishedAt: r.published_at ?? r.created_at ?? '',
    }));
  return { items };
}

export interface RepoStats {
  url: string;
  stars: number;
  forks: number;
  issues: number;
  prs: number;
  watchers: number;
  pushedAt: string;
  defaultBranch: string;
  ci: 'pass' | 'fail' | 'pending' | 'none';
}

export interface RepoResponse {
  repository: {
    url?: string;
    stargazerCount?: number;
    forkCount?: number;
    issues?: { totalCount?: number };
    pullRequests?: { totalCount?: number };
    watchers?: { totalCount?: number };
    pushedAt?: string | null;
    defaultBranchRef?: { name?: string; target?: { statusCheckRollup?: { state?: string } | null } | null } | null;
  } | null;
}

export function mapRepoStats(res: RepoResponse): RepoStats | undefined {
  const r = res.repository;
  if (!r) return undefined;
  const state = r.defaultBranchRef?.target?.statusCheckRollup?.state;
  const ci = state === 'SUCCESS' ? 'pass' : state === 'FAILURE' || state === 'ERROR' ? 'fail' : state === 'PENDING' || state === 'EXPECTED' ? 'pending' : 'none';
  return {
    url: r.url ?? '',
    stars: r.stargazerCount ?? 0,
    forks: r.forkCount ?? 0,
    issues: r.issues?.totalCount ?? 0,
    prs: r.pullRequests?.totalCount ?? 0,
    watchers: r.watchers?.totalCount ?? 0,
    pushedAt: r.pushedAt ?? '',
    defaultBranch: r.defaultBranchRef?.name ?? '',
    ci,
  };
}
