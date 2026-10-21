import { authHeader, sourceFetch, SourceError, type ResolvedConnection } from '../../server';

/** The GraphQL endpoint of a REST base URL: `https://<host>/api/v3` -> `https://<host>/api/graphql`, else `<base>/graphql`. */
export function graphqlUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/api\/v3$/.test(base) ? base.replace(/\/api\/v3$/, '/api/graphql') : `${base}/graphql`;
}

const headers = (conn: ResolvedConnection): Record<string, string> => ({
  Authorization: authHeader(conn, 'github'),
  Accept: 'application/json',
  'User-Agent': 'deckbuilder',
});

/** One GraphQL call; an `errors` array becomes an `upstream` error with the first message. */
export async function graphql<T>(conn: ResolvedConnection, query: string, vars: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
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
