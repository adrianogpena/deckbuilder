import { defineSource, SourceError, type DataSource, type GridPanelSpec } from '../../server';
import { graphql } from './client';
import { fields, ISSUE_SOURCE_FIELDS, PR_SOURCE_FIELDS } from './fields';
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

/** Server specs and data sources of the github panels (no React). */
export const specs: GridPanelSpec[] = [
  { kind: 'github-prs', fields: fields['github-prs'], allowMultiple: true },
  { kind: 'github-issues', fields: fields['github-issues'], allowMultiple: true },
];
export const sources: DataSource<any>[] = [githubPrsSource, githubIssuesSource];
