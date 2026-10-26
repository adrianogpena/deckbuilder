import { authHeader, sourceFetch, SourceError, type ResolvedConnection } from '../../server';

/** The GraphQL endpoint of a REST base URL: `https://<host>/api/v3` -> `https://<host>/api/graphql`, else `<base>/graphql`. */
export function graphqlUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/api\/v3$/.test(base) ? base.replace(/\/api\/v3$/, '/api/graphql') : `${base}/graphql`;
}

const headers = (conn: ResolvedConnection): Record<string, string> => ({
  Authorization: authHeader(conn, 'github'),
  Accept: 'application/json',
  'User-Agent': 'kedalion',
});

export const GRAPHQL_TTL_MS = 30_000;
const MAX_ENTRIES = 200;

interface Shared {
  promise: Promise<unknown>;
  controller: AbortController;
  waiters: number;
  expires: number;
  done: boolean;
}

const shared = new Map<string, Shared>();

const credentialId = (conn: ResolvedConnection): string => `${conn.user ?? ''}:${Bun.hash(conn.token).toString(36)}`;

function evict(now: number): void {
  for (const [k, v] of shared) if (v.done && v.expires <= now) shared.delete(k);
  while (shared.size >= MAX_ENTRIES) {
    const oldest = shared.keys().next().value;
    if (oldest === undefined) break;
    shared.delete(oldest);
  }
}

/** Rejects with the signal's reason as soon as `signal` aborts, without touching `promise`. */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** `graphqlOnce`, but identical calls (same server, credential, query and variables) within 30 s share one request; failures are not kept. A caller's abort only rejects that caller; the request stops when every waiter has aborted. */
export function graphql<T>(conn: ResolvedConnection, query: string, vars: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return sharedCall(`${conn.baseUrl}\n${credentialId(conn)}\n${query}\n${JSON.stringify(vars)}`, (s) => graphqlOnce<T>(conn, query, vars, s), signal);
}

/** The sharing behind `graphql`: one request per `key` while pending and for 30 s after success. */
export function sharedCall<T>(key: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, ttl = GRAPHQL_TTL_MS): Promise<T> {
  const now = Date.now();
  let entry = shared.get(key);
  if (entry && entry.done && entry.expires <= now) {
    shared.delete(key);
    entry = undefined;
  }
  if (!entry) {
    evict(now);
    const controller = new AbortController();
    const created: Shared = { promise: Promise.resolve(), controller, waiters: 0, expires: 0, done: false };
    created.promise = run(controller.signal).then(
      (v) => {
        created.done = true;
        created.expires = Date.now() + ttl;
        return v;
      },
      (e) => {
        if (shared.get(key) === created) shared.delete(key);
        throw e;
      },
    );
    created.promise.catch(() => {});
    shared.set(key, created);
    entry = created;
  }
  const e = entry;
  if (e.done) return untilAborted(e.promise as Promise<T>, signal);
  e.waiters++;
  const release = () => {
    if (--e.waiters === 0 && !e.done) {
      e.controller.abort();
      if (shared.get(key) === e) shared.delete(key);
    }
  };
  const result = untilAborted(e.promise as Promise<T>, signal);
  result.then(release, release);
  return result;
}

/** One GraphQL call; an `errors` array becomes an `upstream` error with the first message. */
async function graphqlOnce<T>(conn: ResolvedConnection, query: string, vars: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await sourceFetch(
    graphqlUrl(conn.baseUrl),
    { method: 'POST', headers: { ...headers(conn), 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables: vars }) },
    { signal },
  );
  const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message?: string }[] };
  if (body.errors?.length) throw SourceError('upstream', 'GitHub rejected the query.', body.errors[0]?.message ?? '');
  if (!body.data) throw SourceError('upstream', 'GitHub returned no data.');
  return body.data;
}

/** One REST GET (`path` starts with `/`). */
export async function rest<T>(conn: ResolvedConnection, path: string, signal?: AbortSignal): Promise<T> {
  const res = await sourceFetch(`${conn.baseUrl.replace(/\/+$/, '')}${path}`, { headers: headers(conn) }, { signal });
  return (await res.json()) as T;
}
