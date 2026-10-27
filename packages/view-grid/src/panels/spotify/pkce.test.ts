import { describe, expect, test } from 'bun:test';
import { authorizeUrl, challengeOf, isExpired, parseTokens, randomToken, redirectUriOf, retryAfterSeconds } from './pkce';

describe('spotify pkce', () => {
  test('S256 challenge of the RFC 7636 example', async () => {
    expect(await challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('random tokens are URL safe and differ', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(randomToken()).not.toBe(a);
  });

  test('redirect URI uses the loopback address and the server port', () => {
    expect(redirectUriOf('http://localhost:4123')).toBe('http://127.0.0.1:4123/api/grid/callback/spotify/auth');
  });

  test('authorize URL carries PKCE, state and scopes', () => {
    const url = new URL(authorizeUrl({ clientId: 'abc', redirectUri: 'http://127.0.0.1:1/cb', state: 's1', challenge: 'ch' }));
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('scope')).toContain('user-modify-playback-state');
  });

  test('expiry with margin', () => {
    expect(isExpired({ expiresAt: 100_000 }, 30_000)).toBe(false);
    expect(isExpired({ expiresAt: 100_000 }, 45_000)).toBe(true);
  });

  test('token answers keep the previous refresh token', () => {
    expect(parseTokens({ access_token: 'a', expires_in: 3600 }, 1000, 'r0')).toEqual({ accessToken: 'a', refreshToken: 'r0', expiresAt: 3_601_000 });
    expect(parseTokens({ access_token: 'a', refresh_token: 'r1', expires_in: 10 }, 0)?.refreshToken).toBe('r1');
    expect(parseTokens({ access_token: 'a', expires_in: 10 }, 0)).toBeUndefined();
    expect(parseTokens(null, 0)).toBeUndefined();
  });

  test('Retry-After', () => {
    expect(retryAfterSeconds('3')).toBe(3);
    expect(retryAfterSeconds(null)).toBe(5);
    expect(retryAfterSeconds('99999')).toBe(3600);
  });
});
