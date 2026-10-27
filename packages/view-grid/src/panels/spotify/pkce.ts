export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'playlist-read-private',
  'user-read-private',
];

export const CALLBACK_PATH = '/api/grid/callback/spotify/auth';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
}

const base64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** A random URL-safe string of `bytes` random bytes (PKCE verifier, OAuth state). */
export const randomToken = (bytes = 48): string => base64Url(crypto.getRandomValues(new Uint8Array(bytes)));

/** The S256 code challenge of a PKCE verifier. */
export async function challengeOf(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** The loopback redirect URI for the server origin of a request (Spotify wants `127.0.0.1`, not `localhost`). */
export function redirectUriOf(origin: string): string {
  const port = new URL(origin).port;
  return `http://127.0.0.1${port ? `:${port}` : ''}${CALLBACK_PATH}`;
}

export function authorizeUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    response_type: 'code',
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge_method: 'S256',
    code_challenge: p.challenge,
    scope: SPOTIFY_SCOPES.join(' '),
  });
  return `https://accounts.spotify.com/authorize?${q}`;
}

/** True when the access token is expired or about to be (default margin 60 s). */
export const isExpired = (t: Pick<Tokens, 'expiresAt'>, now: number, marginMs = 60_000): boolean => t.expiresAt - marginMs <= now;

/** Tokens from a Spotify token answer; a refresh answer may omit the refresh token, so `prevRefresh` is kept. */
export function parseTokens(raw: any, now: number, prevRefresh = ''): Tokens | undefined {
  const accessToken = raw?.access_token;
  const refreshToken = typeof raw?.refresh_token === 'string' && raw.refresh_token ? raw.refresh_token : prevRefresh;
  const seconds = Number(raw?.expires_in);
  if (typeof accessToken !== 'string' || !accessToken || !refreshToken || !(seconds > 0)) return undefined;
  return { accessToken, refreshToken, expiresAt: now + seconds * 1000 };
}

/** Seconds to wait from a `Retry-After` header value (1 to 3600), 5 when missing or invalid. */
export function retryAfterSeconds(value: string | null): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 3600) : 5;
}
