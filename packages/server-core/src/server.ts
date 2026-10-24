import type { ServerWebSocket } from 'bun';
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

/** `ws.data` of every socket: the socket path and the data its ticket carried. */
export interface SocketData {
  path: string;
  data: unknown;
}

/** A WebSocket endpoint; the upgrade redeems the one-time ticket in `?t=` for `data`. */
export interface SocketRoute<T = unknown> {
  tickets: { redeem(ticket: string): T | undefined };
  open(ws: ServerWebSocket<SocketData>, data: T): void;
  message(ws: ServerWebSocket<SocketData>, msg: string | Buffer): void;
  close(ws: ServerWebSocket<SocketData>, code: number, reason: string): void;
}

/** Keys are paths, e.g. '/api/terminal/socket'. */
export type SocketRoutes = Record<string, SocketRoute<any>>;

export interface ServerOptions {
  routes: Routes;
  /** Routes outside the session token check; each handler checks its own credentials. A key ending in `/*` matches every path below it. */
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
  /** WebSocket endpoints; they take a one-time ticket instead of the session token. */
  sockets?: SocketRoutes;
}

const ALLOWED_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX_BODY = 1_000_000;

/**
 * Local HTTP server on 127.0.0.1: serves the built UI and the JSON API.
 * Every /api call needs the session token in the TOKEN_HEADER, so other local programs and web
 * pages can't use it; launch URLs carry a one-time code that the UI trades for it at SESSION_PATH.
 * Browser requests from a foreign Origin are refused before anything else.
 * A `sockets` path upgrades to a WebSocket after the Host and Origin checks when its `?t=` ticket
 * redeems (browsers can't set headers on a WebSocket); it never reaches `routes` or `onActivity`.
 */
export function startServer(opts: ServerOptions) {
  const tokenBuf = Buffer.from(opts.token);
  const serveStatic = staticHandler(opts.web, opts.web.transformIndex);
  const openPrefixes = Object.keys(opts.unauthenticated ?? {}).filter((k) => k.endsWith('/*')).map((k) => k.slice(0, -1));
  const openFor = (key: string) => opts.unauthenticated?.[key] ?? opts.unauthenticated?.[`${openPrefixes.find((p) => key.startsWith(p))}*`];

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

  const sockets = opts.sockets ?? {};
  const socketFor = (ws: ServerWebSocket<SocketData>) => sockets[ws.data.path]!;

  return Bun.serve<SocketData>({
    hostname: '127.0.0.1',
    port: opts.port ?? 0,
    // Above the 200 MB upload cap in rooted-fs, so that cap (not Bun's 128 MiB default) is what answers.
    maxRequestBodySize: 256 * 1024 * 1024,
    websocket: {
      open: (ws) => socketFor(ws).open(ws, ws.data.data),
      message: (ws, msg) => socketFor(ws).message(ws, msg),
      close: (ws, code, reason) => socketFor(ws).close(ws, code, reason),
    },
    async fetch(req, server) {
      const url = new URL(req.url);

      // Blocks DNS rebinding: only loopback host names may reach the server.
      if (!ALLOWED_HOST.test(req.headers.get('host') ?? '')) return new Response('Forbidden host', { status: 403 });

      if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname);

      if (!originAllowed(req, server.port!)) return json(403, { kind: 'forbidden', code: 'badOrigin', message: 'Request from a foreign origin.' });

      if (Object.hasOwn(sockets, url.pathname)) {
        if (req.method !== 'GET') return json(405, { kind: 'invalid', code: 'methodNotAllowed', message: 'Method not allowed.' });
        const data = sockets[url.pathname]!.tickets.redeem(url.searchParams.get('t') ?? '');
        if (data === undefined) return json(401, { kind: 'forbidden', code: 'invalidTicket', message: 'Invalid or expired socket ticket.' });
        if (server.upgrade(req, { data: { path: url.pathname, data } })) return undefined;
        return json(400, { kind: 'invalid', code: 'upgradeRequired', message: 'WebSocket upgrade required.' });
      }

      const key = `${req.method} ${url.pathname}`;
      if (key === `POST ${SESSION_PATH}`) return session(req);

      const open = openFor(key);
      if (!open && !authorized(req)) {
        return json(401, { kind: 'forbidden', code: 'invalidToken', message: 'Invalid session. Open the address printed in the terminal.' });
      }
      if (!open) opts.onActivity?.();
      // Bun drops a request that is silent for 10 s; a slow database query or REST call may take longer.
      if (!open) server.timeout(req, 0);

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
    headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** Reads a JSON object body, counting bytes as they arrive: a chunked body has no Content-Length. */
async function readJson(req: Request): Promise<any> {
  const tooLarge = () => invalid('bodyTooLarge', 'Request body too large.');
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let body: unknown;
  try {
    body = JSON.parse(text || '{}');
  } catch {
    throw invalid('invalidJson', 'Invalid JSON.');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw invalid('invalidJson', 'Invalid JSON.');
  return body;
}
