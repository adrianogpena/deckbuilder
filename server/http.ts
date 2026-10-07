import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TOKEN_HEADER } from '../shared/app.js';
import { AppError } from './errors.js';
import { routes } from './routes.js';

const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));
const ALLOWED_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/**
 * Local HTTP server: serves the built UI and the JSON API from routes.ts.
 * Every /api call needs the session token, so other local programs and web pages can't use it.
 */
export function createApp(token: string) {
  const tokenBuf = Buffer.from(token);

  function authorized(req: IncomingMessage, url: URL): boolean {
    const given = Buffer.from(String(req.headers[TOKEN_HEADER] ?? url.searchParams.get('t') ?? ''));
    return given.length === tokenBuf.length && timingSafeEqual(given, tokenBuf);
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // Blocks DNS rebinding: only loopback host names may reach the server.
    if (!ALLOWED_HOST.test(req.headers.host ?? '')) {
      res.writeHead(403).end('Forbidden host');
      return;
    }

    if (!url.pathname.startsWith('/api/')) {
      try {
        await serveStatic(url.pathname, res);
      } catch {
        if (!res.headersSent) res.writeHead(400).end();
      }
      return;
    }

    if (!authorized(req, url)) {
      sendJson(res, 401, { kind: 'forbidden', code: 'invalidToken', message: 'Invalid session. Open the address printed in the terminal.' });
      return;
    }

    try {
      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) {
        sendJson(res, 404, { kind: 'notfound', code: 'routeNotFound', message: 'Route not found.' });
        return;
      }
      const result = await handler(url.searchParams, req, res);
      if (!res.headersSent) sendJson(res, 200, result);
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError('internal', 'raw', String((err as Error)?.message ?? err));
      if (!res.headersSent) sendJson(res, e.status, e.toJSON());
      else res.end();
    }
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body ?? null));
}

async function serveStatic(pathname: string, res: ServerResponse) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([\\/])+/, '');
  let file = join(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT.endsWith(sep) ? WEB_ROOT : WEB_ROOT + sep) && file !== WEB_ROOT) {
    res.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(WEB_ROOT, 'index.html'); // SPA fallback
  }
  try {
    await stat(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('UI not found. Run "npm run build" first.');
    return;
  }
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}
