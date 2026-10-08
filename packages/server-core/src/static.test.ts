import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticHandler } from './static.ts';

let base: string;
let serve: ReturnType<typeof staticHandler>;
let secret: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'deckbuilder-static-'));
  secret = join(base, 'secret.txt');
  writeFileSync(secret, 'SECRET');
  const web = join(base, 'web');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<!doctype html>INDEX');
  writeFileSync(join(web, 'other.html'), 'OTHER');
  writeFileSync(join(web, 'favicon.svg'), '<svg/>');
  writeFileSync(join(web, 'assets', 'index-a1b2.js'), 'js');
  writeFileSync(join(web, 'assets', 'index-a1b2.css'), 'css');
  serve = staticHandler({ dir: web }, (html) => `${html}+T`);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const get = async (path: string) => {
  const res = await serve(path);
  return { status: res.status, text: await res.text(), headers: res.headers };
};

test('nothing outside the folder is served', async () => {
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/C:/Windows/win.ini', '//server/share', `/${secret.replaceAll('\\', '/')}`]) {
    const res = await get(path);
    expect(res.text).not.toContain('SECRET');
    expect(res.status === 404 || res.text.startsWith('<!doctype html>INDEX')).toBe(true);
  }
});

test('an unknown route gets index.html', async () => {
  const res = await get('/some/route');
  expect(res.status).toBe(200);
  expect(res.text).toBe('<!doctype html>INDEX+T');
  expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
});

test('transformIndex applies to index.html only', async () => {
  expect((await get('/')).text).toBe('<!doctype html>INDEX+T');
  expect((await get('/index.html')).text).toBe('<!doctype html>INDEX+T');
  expect((await get('/other.html')).text).toBe('OTHER');
});

test('MIME types', async () => {
  expect((await get('/assets/index-a1b2.js')).headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  expect((await get('/assets/index-a1b2.css')).headers.get('content-type')).toBe('text/css; charset=utf-8');
  expect((await get('/favicon.svg')).headers.get('content-type')).toBe('image/svg+xml');
});

test('hashed assets are immutable, everything else revalidates', async () => {
  expect((await get('/assets/index-a1b2.js')).headers.get('cache-control')).toContain('immutable');
  expect((await get('/favicon.svg')).headers.get('cache-control')).toBe('no-cache');
  expect((await get('/')).headers.get('cache-control')).toBe('no-cache');
});
