import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SESSION_PATH, TOKEN_HEADER } from './protocol.ts';
import { startServer } from './server.ts';
import { launchCodes, socketTickets } from './session.ts';
import { CSP } from './static.ts';

const TOKEN = 'secret-token';
let server: ReturnType<typeof startServer> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

function start(opts: { codes?: ReturnType<typeof launchCodes>; devOrigins?: string[] } = {}) {
  server = startServer({
    routes: { 'GET /api/ping': () => ({ ok: true }), 'POST /api/echo': ({ json }) => json() },
    token: TOKEN,
    codes: opts.codes ?? launchCodes(),
    devOrigins: opts.devOrigins,
    web: { files: {} },
  });
  return `http://127.0.0.1:${server.port}`;
}

const redeem = (base: string, code: string) =>
  fetch(base + SESSION_PATH, { method: 'POST', body: JSON.stringify({ code }) }).then((r) => r.status);

test('the token is read from the header only', async () => {
  const base = start();
  expect((await fetch(`${base}/api/ping?t=${TOKEN}`)).status).toBe(401);
  expect((await fetch(`${base}/api/ping`, { headers: { [TOKEN_HEADER]: TOKEN } })).status).toBe(200);
});

test('a foreign Origin is refused even with a valid token', async () => {
  const base = start({ devOrigins: ['http://localhost:5173'] });
  const call = (origin: string) => fetch(`${base}/api/ping`, { headers: { [TOKEN_HEADER]: TOKEN, origin } });
  const res = await call('http://evil.example');
  expect(res.status).toBe(403);
  expect(((await res.json()) as any).code).toBe('badOrigin');
  expect((await call(base)).status).toBe(200);
  expect((await call('http://localhost:5173')).status).toBe(200);
});

test('the Vite origin passes only when it is in devOrigins', async () => {
  const base = start();
  const res = await fetch(`${base}/api/ping`, { headers: { [TOKEN_HEADER]: TOKEN, origin: 'http://localhost:5173' } });
  expect(res.status).toBe(403);
});

test('a launch code redeems once for the token', async () => {
  const codes = launchCodes();
  const base = start({ codes });
  const code = codes.issue();
  const res = await fetch(base + SESSION_PATH, { method: 'POST', body: JSON.stringify({ code }) });
  expect(await res.json()).toEqual({ token: TOKEN });
  const again = await fetch(base + SESSION_PATH, { method: 'POST', body: JSON.stringify({ code }) });
  expect(again.status).toBe(401);
  expect(((await again.json()) as any).code).toBe('invalidCode');
});

test('an expired code is refused', async () => {
  let clock = 0;
  const codes = launchCodes({ ttlMs: 1000, now: () => clock });
  const base = start({ codes });
  const code = codes.issue();
  clock = 1001;
  expect(await redeem(base, code)).toBe(401);
});

test('a reusable code redeems more than once', async () => {
  const codes = launchCodes({ reusable: true });
  const base = start({ codes });
  const code = codes.issue();
  expect(codes.issue()).toBe(code);
  expect(await redeem(base, code)).toBe(200);
  expect(await redeem(base, code)).toBe(200);
});

test('only 32 codes stay outstanding', () => {
  const codes = launchCodes();
  const first = codes.issue();
  for (let i = 0; i < 32; i++) codes.issue();
  expect(codes.redeem(first)).toBe(false);
});

test('a non-loopback Host is refused', async () => {
  const base = start();
  const res = await fetch(`${base}/api/ping`, { headers: { [TOKEN_HEADER]: TOKEN, host: 'evil.example' } });
  expect(res.status).toBe(403);
});

test('index.html gets the CSP, every static file nosniff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deckbuilder-static-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'a.js'), '');
    server = startServer({ routes: {}, token: TOKEN, codes: launchCodes(), web: { dir } });
    const base = `http://127.0.0.1:${server.port}`;
    const index = await fetch(`${base}/`);
    expect(index.headers.get('content-security-policy')).toBe(CSP);
    expect(index.headers.get('referrer-policy')).toBe('no-referrer');
    const asset = await fetch(`${base}/assets/a.js`);
    expect(asset.headers.get('x-content-type-options')).toBe('nosniff');
    expect(asset.headers.get('content-security-policy')).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const SOCKET = '/api/test/socket';

function startSockets() {
  const tickets = socketTickets<string>();
  const opened: string[] = [];
  let activity = 0;
  server = startServer({
    routes: { 'GET /api/ping': () => ({ ok: true }), [`GET ${SOCKET}`]: () => ({ handler: true }) },
    token: TOKEN,
    codes: launchCodes(),
    web: { files: {} },
    onActivity: () => activity++,
    sockets: {
      [SOCKET]: {
        tickets,
        open: (_ws, data: string) => opened.push(data),
        message: (ws, msg) => ws.send(msg),
        close: () => {},
      },
    },
  });
  return { port: server.port, tickets, opened, activity: () => activity };
}

function connect(url: string, headers?: Record<string, string>) {
  const ws = new WebSocket(url, { headers } as any);
  ws.binaryType = 'arraybuffer';
  const opened = new Promise<boolean>((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
    ws.onclose = () => resolve(false);
  });
  return { ws, opened };
}

const nextMessage = (ws: WebSocket) =>
  new Promise<unknown>((resolve) => ws.addEventListener('message', (e) => resolve(e.data), { once: true }));

test('a socket path without a valid ticket is refused before any handler', async () => {
  const { port, tickets, activity } = startSockets();
  const base = `http://127.0.0.1:${port}`;
  const res = await fetch(`${base}${SOCKET}`, { headers: { [TOKEN_HEADER]: TOKEN } });
  expect(res.status).toBe(401);
  expect(((await res.json()) as any).code).toBe('invalidTicket');
  expect((await fetch(`${base}${SOCKET}?t=bogus`)).status).toBe(401);
  expect((await fetch(`${base}${SOCKET}?t=${tickets.issue('x')}`)).status).toBe(400);
  expect(activity()).toBe(0);
});

test('a socket upgrade from a foreign Origin fails', async () => {
  const { port, tickets, opened } = startSockets();
  const ticket = tickets.issue('x');
  const res = await fetch(`http://127.0.0.1:${port}${SOCKET}?t=${ticket}`, {
    headers: { origin: 'http://evil.example', connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' },
  });
  expect(res.status).toBe(403);
  const { opened: ok } = connect(`ws://127.0.0.1:${port}${SOCKET}?t=${ticket}`, { Origin: 'http://evil.example' });
  expect(await ok).toBe(false);
  expect(opened).toEqual([]);
});

test('a valid ticket opens a socket once and frames round-trip', async () => {
  const { port, tickets, opened, activity } = startSockets();
  const ticket = tickets.issue('session-1');
  const url = `ws://127.0.0.1:${port}${SOCKET}?t=${ticket}`;
  const { ws, opened: ok } = connect(url, { Origin: `http://127.0.0.1:${port}` });
  expect(await ok).toBe(true);
  expect(opened).toEqual(['session-1']);

  const text = nextMessage(ws);
  ws.send('hello');
  expect(await text).toBe('hello');
  const binary = nextMessage(ws);
  ws.send(new Uint8Array([1, 2, 3]));
  expect(new Uint8Array((await binary) as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
  ws.close();

  expect(await connect(url).opened).toBe(false);
  expect(activity()).toBe(0);
});

const post = (base: string, body: string | ReadableStream<Uint8Array>) =>
  fetch(`${base}/api/echo`, { method: 'POST', headers: { [TOKEN_HEADER]: TOKEN }, body })
    .then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));

test('a chunked body over the cap is refused while it is read', async () => {
  const base = start();
  const chunk = new Uint8Array(64 * 1024).fill(32);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 2_000_000) return controller.close();
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const res = await post(base, body);
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('bodyTooLarge');
});

test('only an object body is accepted', async () => {
  const base = start();
  expect((await post(base, '[]')).body.code).toBe('invalidJson');
  expect((await post(base, 'null')).status).toBe(400);
  expect((await post(base, '1')).body.code).toBe('invalidJson');
  expect(await post(base, '')).toEqual({ status: 200, body: {} });
  expect(await post(base, '{"a":1}')).toEqual({ status: 200, body: { a: 1 } });
});
