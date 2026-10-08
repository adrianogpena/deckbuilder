import { timingSafeEqual } from 'node:crypto';
import { AppError, invalid } from './errors.ts';
import { SESSION_PATH, TOKEN_HEADER } from './protocol.ts';
import type { LaunchCodes } from './session.ts';
import { type IndexTransform, staticHandler, type WebSource } from './static.ts';

export interface RouteContext {
  req: Request;
  url: URL;
  query: URLSearchParams;
  /** Parsed JSON body (`{}` when empty); throws an `invalid` AppError on bad or oversized input. */
  json<T = any>(): Promise<T>;
}

/** Returns a JSON-serializable value, or a Response for anything else (streams, files). */
export type Handler = (ctx: RouteContext) => unknown;

/** The API. Keys are "METHOD /path"; handlers throw an AppError (see errors.ts) for errors the UI shows. */
export type Routes = Record<string, Handler>;

export interface ServerOptions {
  routes: Routes;
  /** Routes outside the session token check; each handler checks its own credentials. */
  unauthenticated?: Routes;
  token: string;
  /** Launch codes that `POST /api/session` trades for the token. */
  codes: LaunchCodes;
  /** Extra origins allowed to call /api, e.g. the Vite dev server. */
  devOrigins?: string[];
  web: WebSource & { transformIndex?: IndexTransform };
  /** 0 picks any free port. */
  port?: number;
  /** Called for every request that passed the session token check. */
  onActivity?: () => void;
}

const ALLOWED_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX_BODY = 1_000_000;

/**
 * Local HTTP server on 127.0.0.1: serves the built UI and the JSON API.
 * Every /api call needs the session token in the TOKEN_HEADER, so other local programs and web
 * pages can't use it; launch URLs carry a one-time code that the UI trades for it at SESSION_PATH.
 * Browser requests from a foreign Origin are refused before anything else.
 */
export function startServer(opts: ServerOptions) {
  const tokenBuf = Buffer.from(opts.token);
  const serveStatic = staticHandler(opts.web, opts.web.transformIndex);

  function authorized(req: Request): boolean {
    const given = Buffer.from(req.headers.get(TOKEN_HEADER) ?? '');
    return given.length === tokenBuf.length && timingSafeEqual(given, tokenBuf);
  }

  // Requests without Origin (curl, same-origin GET) pass on to the token check.
  function originAllowed(req: Request, port: number): boolean {
    const origin = req.headers.get('origin');
    if (origin === null) return true;
    const own = [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
    return own.includes(origin) || (opts.devOrigins ?? []).includes(origin);
  }

  async function session(req: Request): Promise<Response> {
    const body = await readJson(req).catch(() => ({}));
    if (typeof body?.code === 'string' && opts.codes.redeem(body.code)) return json(200, { token: opts.token });
    return json(401, { kind: 'forbidden', code: 'invalidCode', message: 'This link was already used or has expired. Open the app again.' });
  }

  return Bun.serve({
    hostname: '127.0.0.1',
    port: opts.port ?? 0,
    async fetch(req, server) {
      const url = new URL(req.url);

      // Blocks DNS rebinding: only loopback host names may reach the server.
      if (!ALLOWED_HOST.test(req.headers.get('host') ?? '')) return new Response('Forbidden host', { status: 403 });

      if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname);

      if (!originAllowed(req, server.port!)) return json(403, { kind: 'forbidden', code: 'badOrigin', message: 'Request from a foreign origin.' });

      const key = `${req.method} ${url.pathname}`;
      if (key === `POST ${SESSION_PATH}`) return session(req);

      const open = opts.unauthenticated?.[key];
      if (!open && !authorized(req)) {
        return json(401, { kind: 'forbidden', code: 'invalidToken', message: 'Invalid session. Open the address printed in the terminal.' });
      }
      if (!open) opts.onActivity?.();

      const handler = open ?? opts.routes[key];
      if (!handler) return json(404, { kind: 'notfound', code: 'routeNotFound', message: 'Route not found.' });

      try {
        const result = await handler({ req, url, query: url.searchParams, json: () => readJson(req) });
        return result instanceof Response ? result : json(200, result);
      } catch (err) {
        if (!(err instanceof AppError)) console.error(err);
        const e = err instanceof AppError ? err : new AppError('internal', 'raw', String((err as Error)?.message ?? err));
        return json(e.status, e.toJSON());
      }
    },
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? null), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readJson(req: Request): Promise<any> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) throw invalid('bodyTooLarge', 'Request body too large.');
  const text = await req.text();
  if (text.length > MAX_BODY) throw invalid('bodyTooLarge', 'Request body too large.');
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw invalid('invalidJson', 'Invalid JSON.');
  }
}
