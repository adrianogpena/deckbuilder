import { invalid } from '@kedalion/server-core';
import { defineSource, SourceError, type DataSource, type GridPanelSpec, type ResolvedConnection } from '../../server';
import { createJsonStore, type JsonStore } from '../../json-store';
import { graphql, rest } from './client';
import { mapLimit } from './limit';
import { parseTrackedPrRef, toTrackedPr, type PrNode, type PrRef, type TrackedPr } from './tracked';
import { ACTIONS_SOURCE_FIELDS, TRACKED_SOURCE_FIELDS, fields,ISSUE_SOURCE_FIELDS, NOTIFICATIONS_SOURCE_FIELDS, OVERVIEW_SOURCE_FIELDS, PR_SOURCE_FIELDS, RELEASES_FIELDS } from './fields';
import { mapNotifications, mapReleases, mapRepoStats, mapRuns, parseRepo, runsPath, type RepoResponse } from './more';
import { buildQuery, mapIssues, mapPullRequests, nextRefreshMs, PR_REFRESH_MS, type SearchResponse } from './map';

import { BOT_LOGIN, parseBotComments, type BotComment } from './bot';
import { isRcComment, parseRcComment } from './rc';

const RATE ='rateLimit { remaining limit resetAt }';

const PR_QUERY = `query($q: String!, $n: Int!) {
  search(query: $q, type: ISSUE, first: $n) {
    issueCount
    nodes {
      ... on PullRequest {
        number title url isDraft state headRefName baseRefName updatedAt createdAt reviewDecision
        additions deletions changedFiles mergeable
        autoMergeRequest { enabledAt }
        comments { totalCount }
        reviewThreads(first: 100) { nodes { isResolved } }
        author { login }
        repository { nameWithOwner }
        labels(first: 10) { nodes { name } }
        commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 50) { nodes { __typename ... on CheckRun { name status conclusion startedAt completedAt detailsUrl title summary checkSuite { workflowRun { workflow { name } } } } ... on StatusContext { context state targetUrl description } } } } } } }
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
    const data = mapPullRequests(res, config.ticketPattern ?? '');
    let board: Set<string> | null = null;
    try {
      const { ticketsStore } = await import('../tickets/server');
      board = new Set((await ticketsStore(ctx.dataDir).read()).tickets.map((t) => t.key.toUpperCase()));
    } catch {
      board = null;
    }
    const items = board ? data.items.map((pr) => ({ ...pr, linked: !!pr.ticket && board.has(pr.ticket.toUpperCase()) })) : data.items;
    return { ...data, items, ...(nextRefreshMs ? { nextRefreshMs } : {}) };
  },
  actions: {
    async rc(payload, config, ctx) {
      const p = payload as { repo?: unknown; number?: unknown } | null;
      const ref = typeof p?.repo === 'string' ? parseRepo(p.repo) : null;
      const number = Number(p?.number);
      if (!ref || !Number.isInteger(number) || number <= 0) throw invalid('rc-pr-ref', 'A pull request is required.');
      const conn = await ctx.connection(config.connection, 'github');
      let found: string | null = null;
      const botComments: BotComment[] = [];
      for (let page = 1; page <= 5; page++) {
        const list = await rest<{ body?: string | null; user?: { login?: string } | null; updated_at?: string; html_url?: string }[]>(conn, `/repos/${ref}/issues/${number}/comments?per_page=100&page=${page}`, ctx.signal);
        for (const c of list) {
          if (!c.body || c.user?.login !== BOT_LOGIN) continue;
          const rc = isRcComment(c.body);
          if (rc) found = c.body;
          botComments.push({ body: c.body, updatedAt: c.updated_at ?? '', url: c.html_url ?? '', rc });
        }
        if (list.length < 100) break;
      }
      return { rc: found ? parseRcComment(found) : null, bot: parseBotComments(botComments) };
    },
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

const PR_FIELDS = `number title url isDraft state merged headRefName
  labels(first: 30) { nodes { name } }
  mergeStateStatus reviewDecision
  latestReviews(first: 50) { nodes { state } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { __typename ... on CheckRun { name status conclusion startedAt completedAt detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }`;

const CHUNK = 5;
/** Concurrent GraphQL requests per lookup; GitHub penalizes many at once. */
const CONCURRENCY = 4;
export const MAX_TRACKED = 50;

export interface TrackedOptions {
  readyLabel: string;
  rcLabel: string;
}

const DEFAULT_LABELS: TrackedOptions = { readyLabel: 'ready to merge', rcLabel: 'rc' };

/** The PRs of `refs` (chunks of 5 per GraphQL request), in the order of `refs`; PRs that no longer resolve are left out. */
export async function fetchPrs(conn: ResolvedConnection, refs: readonly PrRef[], signal?: AbortSignal, opts: TrackedOptions = DEFAULT_LABELS): Promise<TrackedPr[]> {
  const out: (TrackedPr | undefined)[] = new Array(refs.length);
  const starts = Array.from({ length: Math.ceil(refs.length / CHUNK) }, (_, c) => c * CHUNK);
  await mapLimit(starts, CONCURRENCY, async (i) => {
    const chunk = refs.slice(i, i + CHUNK);
    const query = `query(${chunk.map((_, k) => `$o${k}: String!, $n${k}: String!, $p${k}: Int!`).join(', ')}) {
${chunk.map((_, k) => `  t${k}: repository(owner: $o${k}, name: $n${k}) { pullRequest(number: $p${k}) { ${PR_FIELDS} } }`).join('\n')}
}`;
    const vars: Record<string, unknown> = {};
    chunk.forEach((r, k) => Object.assign(vars, { [`o${k}`]: r.owner, [`n${k}`]: r.repo, [`p${k}`]: r.number }));
    const res = await graphql<Record<string, { pullRequest: PrNode | null } | null>>(conn, query, vars, signal);
    chunk.forEach((ref, k) => {
      const node = res[`t${k}`]?.pullRequest;
      if (node) out[i + k] = toTrackedPr(node, ref, opts);
    });
  });
  return out.filter((p): p is TrackedPr => !!p);
}

const POOL_QUERY = `query($mine: String!, $review: String!) {
  mine: search(query: $mine, type: ISSUE, first: 50) { nodes { ... on PullRequest { number repository { nameWithOwner } } } }
  review: search(query: $review, type: ISSUE, first: 50) { nodes { ... on PullRequest { number repository { nameWithOwner } } } }
}`;

type PoolNode = { number: number; repository?: { nameWithOwner: string } };

const KEY_CHUNK = 10;
const KEY_PRS = 10;

/** Refs of PRs (any state, any author) whose title or branch mentions one of `keys`, found by one light search per key. */
async function findKeyPrRefs(conn: ResolvedConnection, keys: readonly string[], signal?: AbortSignal): Promise<PrRef[]> {
  const starts = Array.from({ length: Math.ceil(keys.length / KEY_CHUNK) }, (_, c) => c * KEY_CHUNK);
  const parts = await mapLimit(starts, CONCURRENCY, async (i) => {
    const out: PrRef[] = [];
    const chunk = keys.slice(i, i + KEY_CHUNK);
    const query = `query(${chunk.map((_, k) => `$q${k}: String!`).join(', ')}) {
${chunk.map((_, k) => `  k${k}: search(query: $q${k}, type: ISSUE, first: ${KEY_PRS}) { nodes { ... on PullRequest { number title headRefName repository { nameWithOwner } } } }`).join('\n')}
}`;
    const vars: Record<string, unknown> = {};
    chunk.forEach((key, k) => Object.assign(vars, { [`q${k}`]: `is:pr in:title,body "${key}" sort:updated-desc` }));
    const res = await graphql<Record<string, { nodes: ({ number: number; title: string; headRefName?: string; repository?: { nameWithOwner: string } } | null)[] }>>(conn, query, vars, signal);
    chunk.forEach((key, k) => {
      const whole = new RegExp(`(?<![A-Za-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`, 'i');
      for (const node of res[`k${k}`]?.nodes ?? []) {
        const [owner, repo] = node?.repository?.nameWithOwner.split('/') ?? [];
        if (node && owner && repo && (whole.test(node.title) || whole.test(node.headRefName ?? ''))) out.push({ owner, repo, number: node.number });
      }
    });
    return out;
  });
  return parts.flat();
}

/** Open PRs of the user (`mine`), those awaiting their review (`review`), the tracked ones and, when `keys` is given, any PR titled with one of them; each but the last tagged with its `scope`. */
export async function fetchPrPool(conn: ResolvedConnection, { tracked, keys = [], signal, ...opts }: { tracked: readonly PrRef[]; keys?: readonly string[]; signal?: AbortSignal } & Partial<TrackedOptions>): Promise<TrackedPr[]> {
  const labels = { ...DEFAULT_LABELS, ...opts };
  const [res, trackedPrs, keyRefs] = await Promise.all([
    graphql<Record<'mine' | 'review', { nodes: (PoolNode | null)[] }>>(conn, POOL_QUERY, { mine: 'is:pr is:open author:@me', review: 'is:pr is:open review-requested:@me' }, signal),
    fetchPrs(conn, tracked, signal, labels),
    keys.length ? findKeyPrRefs(conn, keys, signal).catch((): PrRef[] | null => null) : Promise.resolve<PrRef[] | null>([]),
  ]);
  const refKey = (r: PrRef) => `${r.owner}/${r.repo}#${r.number}`;
  const scoped = (['mine', 'review'] as const).flatMap((scope) =>
    res[scope].nodes.flatMap((node) => {
      const [owner, repo] = node?.repository?.nameWithOwner.split('/') ?? [];
      return node && owner && repo ? [{ scope, ref: { owner, repo, number: node.number } }] : [];
    }),
  );
  const unique = [...new Map(scoped.map((s) => [refKey(s.ref), s.ref])).values()];
  const byKey = new Map((await fetchPrs(conn, unique, signal, labels)).map((p) => [refKey(p), p]));
  const out: TrackedPr[] = [];
  for (const { scope, ref } of scoped) {
    const pr = byKey.get(refKey(ref));
    if (pr) out.push({ ...pr, scope });
  }
  for (const pr of trackedPrs) out.push({ ...pr, scope: 'tracked' });
  if (keyRefs?.length) {
    try {
      const seen = new Set(out.map(refKey));
      const refs = keyRefs.filter((r) => !seen.has(refKey(r)));
      out.push(...(await fetchPrs(conn, refs, signal, labels)));
    } catch {
      // the lookup by key is best-effort; keep the PRs already found
    }
  }
  return out;
}

interface TrackedStore {
  refs: PrRef[];
}

const parseStore = (raw: unknown): TrackedStore => {
  const list = (raw as { refs?: unknown })?.refs;
  const refs = Array.isArray(list)
    ? list.filter((r): r is PrRef => !!r && typeof r.owner === 'string' && typeof r.repo === 'string' && Number.isInteger(r.number))
    : [];
  return { refs: refs.slice(0, MAX_TRACKED).map(({ owner, repo, number }) => ({ owner, repo, number })) };
};

const stores = new Map<string, JsonStore<TrackedStore>>();
/** The `tracked-prs` store of a data dir. */
export function trackedStore(dataDir: string): JsonStore<TrackedStore> {
  let s = stores.get(dataDir);
  if (!s) {
    s = createJsonStore({ dataDir, name: 'tracked-prs', parse: parseStore, empty: () => ({ refs: [] }) });
    stores.set(dataDir, s);
  }
  return s;
}

const sameRef = (a: PrRef, b: PrRef) => a.number === b.number && a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();

interface TrackedConfig {
  connection: string;
  readyLabel: string;
  rcLabel: string;
  [key: string]: unknown;
}

export const githubTrackedSource = defineSource<TrackedConfig>({
  id: 'github-tracked',
  fields: TRACKED_SOURCE_FIELDS,
  async fetch(config, ctx) {
    const { refs } = await trackedStore(ctx.dataDir).read();
    if (!refs.length) return { items: [] as TrackedPr[] };
    const conn = await ctx.connection(config.connection, 'github');
    return { items: await fetchPrs(conn, refs, ctx.signal, config) };
  },
  actions: {
    async track(payload, _config, ctx) {
      const input = (payload as { ref?: unknown } | null)?.ref;
      const ref = typeof input === 'string' ? parseTrackedPrRef(input) : null;
      if (!ref) throw invalid('tracked-pr-ref', 'Paste a GitHub pull request link or owner/repo#123.');
      await trackedStore(ctx.dataDir).update((s) =>
        s.refs.some((r) => sameRef(r, ref)) || s.refs.length >= MAX_TRACKED ? s : { refs: [...s.refs, ref] },
      );
      return null;
    },
    async untrack(payload, _config, ctx) {
      const ref = payload as PrRef;
      await trackedStore(ctx.dataDir).update((s) => ({ refs: s.refs.filter((r) => !sameRef(r, ref)) }));
      return null;
    },
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
  { kind: 'github-tracked', fields: fields['github-tracked'], allowMultiple: false },
];
export const sources: DataSource<any>[] = [
  githubPrsSource,
  githubIssuesSource,
  githubActionsSource,
  githubNotificationsSource,
  githubReleasesSource,
  githubOverviewSource,
  githubTrackedSource,
];
