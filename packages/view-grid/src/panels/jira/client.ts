import { authHeader, sourceFetch, type ResolvedConnection } from '../../server';
import { pickFieldIds, type FieldIds } from './map';

type Raw = Record<string, any>;

const trimBase = (conn: ResolvedConnection): string => conn.baseUrl.replace(/\/+$/, '');

/** Headers of every Jira request: basic auth with a user (Cloud), bearer without (Server / Data Center PAT). */
export const jiraHeaders = (conn: ResolvedConnection): Record<string, string> => ({
  Authorization: authHeader(conn, 'jira'),
  Accept: 'application/json',
});

/** `POST /rest/api/3/search/jql` request. */
export function searchV3Request(conn: ResolvedConnection, jql: string, fields: readonly string[], max: number): { url: string; init: RequestInit } {
  return {
    url: `${trimBase(conn)}/rest/api/3/search/jql`,
    init: { method: 'POST', headers: { ...jiraHeaders(conn), 'Content-Type': 'application/json' }, body: JSON.stringify({ jql, maxResults: max, fields }) },
  };
}

/** `GET /rest/api/2/search` request. */
export function searchV2Request(conn: ResolvedConnection, jql: string, fields: readonly string[], max: number): { url: string; init: RequestInit } {
  const q = new URLSearchParams({ jql, maxResults: String(max), fields: fields.join(',') });
  return { url: `${trimBase(conn)}/rest/api/2/search?${q}`, init: { headers: jiraHeaders(conn) } };
}

/** Whether a failed request means the endpoint does not exist (the v3 to v2 fallback). */
export function isNotFound(err: unknown): boolean {
  const detail = (err as { opts?: { detail?: string } } | null)?.opts?.detail;
  return typeof detail === 'string' && detail.startsWith('404');
}

const noV3 = new Set<string>();
const noApproxCount = new Set<string>();

async function json(res: Response): Promise<Raw> {
  return (await res.json()) as Raw;
}

/** Issues matching `jql` with `fields`; v3 first, v2 when v3 answers 404 (remembered per server). */
export async function search(conn: ResolvedConnection, jql: string, fields: readonly string[], max: number, signal: AbortSignal): Promise<Raw[]> {
  const base = trimBase(conn);
  if (!noV3.has(base)) {
    const r = searchV3Request(conn, jql, fields, max);
    try {
      return ((await json(await sourceFetch(r.url, r.init, { signal }))).issues ?? []) as Raw[];
    } catch (err) {
      if (!isNotFound(err)) throw err;
      noV3.add(base);
    }
  }
  const r = searchV2Request(conn, jql, fields, max);
  return ((await json(await sourceFetch(r.url, r.init, { signal }))).issues ?? []) as Raw[];
}

/** How many issues match `jql`: `approximate-count` on v3, `total` of v2 when that is missing. */
export async function count(conn: ResolvedConnection, jql: string, signal: AbortSignal): Promise<number> {
  const base = trimBase(conn);
  if (!noV3.has(base) && !noApproxCount.has(base)) {
    try {
      const res = await sourceFetch(`${base}/rest/api/3/search/approximate-count`, { method: 'POST', headers: { ...jiraHeaders(conn), 'Content-Type': 'application/json' }, body: JSON.stringify({ jql }) }, { signal });
      return Number((await json(res)).count ?? 0);
    } catch (err) {
      if (!isNotFound(err)) throw err;
      noApproxCount.add(base);
    }
  }
  const r = searchV2Request(conn, jql, ['summary'], 0);
  try {
    return Number((await json(await sourceFetch(r.url, r.init, { signal }))).total ?? 0);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    return (await search(conn, jql, ['summary'], 100, signal)).length;
  }
}

/** `GET /rest/agile/1.0<path>`. */
export async function agile(conn: ResolvedConnection, path: string, signal: AbortSignal): Promise<Raw> {
  return json(await sourceFetch(`${trimBase(conn)}/rest/agile/1.0${path}`, { headers: jiraHeaders(conn) }, { signal }));
}

const fieldCache = new Map<string, Promise<FieldIds>>();

/** The story points and sprint field ids of the server, read once per connection for the server's life. */
export function fieldIds(conn: ResolvedConnection, signal: AbortSignal): Promise<FieldIds> {
  const key = `${trimBase(conn)}|${conn.user ?? ''}`;
  let hit = fieldCache.get(key);
  if (!hit) {
    hit = sourceFetch(`${trimBase(conn)}/rest/api/2/field`, { headers: jiraHeaders(conn) }, { signal })
      .then(async (res) => pickFieldIds(await res.json()))
      .catch((err) => {
        fieldCache.delete(key);
        if (signal.aborted) throw err;
        return {};
      });
    fieldCache.set(key, hit);
  }
  return hit;
}
