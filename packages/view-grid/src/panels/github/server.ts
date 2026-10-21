import { defineSource, SourceError, type DataSource, type GridPanelSpec } from '../../server';
import { graphql, rest } from './client';
import { ACTIONS_SOURCE_FIELDS, fields, ISSUE_SOURCE_FIELDS, NOTIFICATIONS_SOURCE_FIELDS, OVERVIEW_SOURCE_FIELDS, PR_SOURCE_FIELDS, RELEASES_FIELDS } from './fields';
import { mapNotifications, mapReleases, mapRepoStats, mapRuns, parseRepo, runsPath, type RepoResponse } from './more';
import { buildQuery, mapIssues, mapPullRequests, nextRefreshMs, PR_REFRESH_MS, type SearchResponse } from './map';

const RATE = 'rateLimit { remaining limit resetAt }';

const PR_QUERY = `query($q: String!, $n: Int!) {
  search(query: $q, type: ISSUE, first: $n) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url isDraft state headRefName updatedAt reviewDecision
        author { login }
        repository { nameWithOwner }
        labels(first: 10) { nodes { name } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 50) { nodes { __typename ... on CheckRun { name conclusion } ... on StatusContext { context state } } } } } } }
      }
    }
  }
  ${RATE}
}`;

const ISSUE_QUERY = `query($q: String!, $n: Int!) {
  search(query: $q, type: ISSUE, first: $n) {
    issueCount
    nodes {
      ... on Issue {
        number title url state updatedAt
        author { login }
        repository { nameWithOwner }
        labels(first: 10) { nodes { name } }
        assignees(first: 5) { nodes { login } }
        comments { totalCount }
        milestone { title }
      }
    }
  }
  ${RATE}
}`;

interface SearchConfig {
  connection: string;
  mode: string;
  repo: string;
  query: string;
  max: number;
  ticketPattern?: string;
  [key: string]: unknown;
}

const backoff = new Map<string, number>();

async function search(kind: 'pr' | 'issue', config: SearchConfig, ctx: Parameters<DataSource['fetch']>[1]): Promise<{ res: SearchResponse; nextRefreshMs?: number }> {
  const q = buildQuery(kind, config.mode, config.repo, config.query);
  if (!q) throw SourceError('not-configured', kind === 'pr' ? 'The pull request search is not set up.' : 'The issue search is not set up.');
  const conn = await ctx.connection(config.connection, 'github');
  const res = await graphql<SearchResponse>(conn, kind === 'pr' ? PR_QUERY : ISSUE_QUERY, { q, n: config.max }, ctx.signal);
  const next = nextRefreshMs(res.rateLimit && { remaining: res.rateLimit.remaining ?? 0, limit: res.rateLimit.limit ?? 0 }, PR_REFRESH_MS, backoff.get(conn.baseUrl));
  if (next) backoff.set(conn.baseUrl, next);
  else backoff.delete(conn.baseUrl);
  return { res, nextRefreshMs: next };
}

export const githubPrsSource = defineSource<SearchConfig>({
  id: 'github-prs',
  fields: PR_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const { res, nextRefreshMs } = await search('pr', config, ctx);
    return { ...mapPullRequests(res, config.ticketPattern ?? ''), ...(nextRefreshMs ? { nextRefreshMs } : {}) };
  },
});

export const githubIssuesSource = defineSource<SearchConfig>({
  id: 'github-issues',
  fields: ISSUE_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const { res, nextRefreshMs } = await search('issue', config, ctx);
    return { ...mapIssues(res), ...(nextRefreshMs ? { nextRefreshMs } : {}) };
  },
});

interface RepoConfig {
  connection: string;
  repo: string;
  max: number;
  [key: string]: unknown;
}

function needRepo(repo: string): string {
  const r = parseRepo(repo);
  if (!r) throw SourceError('not-configured', 'Set a repository as owner/name.');
  return r;
}

export const githubActionsSource = defineSource<RepoConfig & { branch: string; workflow: string }>({
  id: 'github-actions',
  fields: ACTIONS_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const repo = needRepo(config.repo);
    const conn = await ctx.connection(config.connection, 'github');
    const raw = await rest<Parameters<typeof mapRuns>[0]>(conn, runsPath(repo, config.branch ?? '', config.workflow ?? '', config.max), ctx.signal);
    return mapRuns(raw, config.max);
  },
});

export const githubNotificationsSource = defineSource<{ connection: string; participatingOnly: boolean; max: number; [key: string]: unknown }>({
  id: 'github-notifications',
  fields: NOTIFICATIONS_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const conn = await ctx.connection(config.connection, 'github');
    const q = new URLSearchParams({ per_page: String(config.max) });
    if (config.participatingOnly) q.set('participating', 'true');
    const raw = await rest<Parameters<typeof mapNotifications>[0]>(conn, `/notifications?${q}`, ctx.signal);
    return mapNotifications(raw, config.max);
  },
});

export const githubReleasesSource = defineSource<RepoConfig & { includePrereleases: boolean }>({
  id: 'github-releases',
  fields: RELEASES_FIELDS,
  async fetch(config, ctx) {
    const repo = needRepo(config.repo);
    const conn = await ctx.connection(config.connection, 'github');
    const raw = await rest<Parameters<typeof mapReleases>[0]>(conn, `/repos/${repo}/releases?per_page=${Math.min(100, config.max * 2)}`, ctx.signal);
    return mapReleases(raw, config.max, !!config.includePrereleases);
  },
});

const OVERVIEW_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    url stargazerCount forkCount
    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN) { totalCount }
    watchers { totalCount }
    pushedAt
    defaultBranchRef { name target { ... on Commit { statusCheckRollup { state } } } }
  }
}`;

export const githubOverviewSource = defineSource<{ connection: string; repo: string; [key: string]: unknown }>({
  id: 'github-overview',
  fields: OVERVIEW_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const [owner, name] = needRepo(config.repo).split('/');
    const conn = await ctx.connection(config.connection, 'github');
    const res = await graphql<RepoResponse>(conn, OVERVIEW_QUERY, { owner, name }, ctx.signal);
    const stats = mapRepoStats(res);
    if (!stats) throw SourceError('upstream', 'Repository not found.');
    return stats;
  },
});

/** Server specs and data sources of the github panels (no React). */
export const specs: GridPanelSpec[] = [
  { kind: 'github-prs', fields: fields['github-prs'], allowMultiple: true },
  { kind: 'github-issues', fields: fields['github-issues'], allowMultiple: true },
  { kind: 'github-actions', fields: fields['github-actions'], allowMultiple: true },
  { kind: 'github-notifications', fields: fields['github-notifications'], allowMultiple: true },
  { kind: 'github-releases', fields: fields['github-releases'], allowMultiple: true },
  { kind: 'github-overview', fields: fields['github-overview'], allowMultiple: true },
];
export const sources: DataSource<any>[] = [
  githubPrsSource,
  githubIssuesSource,
  githubActionsSource,
  githubNotificationsSource,
  githubReleasesSource,
  githubOverviewSource,
];
