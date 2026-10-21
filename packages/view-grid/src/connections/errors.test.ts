import { afterEach, describe, expect, test } from 'bun:test';
import { codeForStatus, SourceError, sourceFetch } from './errors';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const h = (init: Record<string, string> = {}) => new Headers(init);

describe('codeForStatus', () => {
  test('maps statuses', () => {
    expect(codeForStatus(401, h())).toBe('auth');
    expect(codeForStatus(403, h())).toBe('auth');
    expect(codeForStatus(403, h({ 'x-ratelimit-remaining': '0' }))).toBe('rate-limited');
    expect(codeForStatus(429, h())).toBe('rate-limited');
    expect(codeForStatus(500, h())).toBe('upstream');
    expect(codeForStatus(404, h())).toBe('upstream');
  });
});

describe('SourceError', () => {
  test('prefixes the code', () => {
    const e = SourceError('auth', 'x');
    expect(e.code).toBe('source-auth');
    expect(e.toJSON().code).toBe('source-auth');
  });
});

describe('sourceFetch', () => {
  test('returns an ok response', async () => {
    globalThis.fetch = (async () => new Response('{}')) as unknown as typeof fetch;
    expect((await sourceFetch('http://x')).ok).toBe(true);
  });

  test('network failure is offline', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('down');
    }) as unknown as typeof fetch;
    await expect(sourceFetch('http://x')).rejects.toMatchObject({ code: 'source-offline' });
  });

  test('status becomes a code', async () => {
    globalThis.fetch = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    await expect(sourceFetch('http://x')).rejects.toMatchObject({ code: 'source-auth' });
  });
});
