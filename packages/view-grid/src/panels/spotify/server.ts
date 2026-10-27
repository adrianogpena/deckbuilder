import { invalid } from '@kedalion/server-core';
import { SourceError } from '../../connections/errors';
import { createJsonStore, type JsonStore } from '../../json-store';
import { defineSource, type DataSource, type GridPanelSpec, type SourceContext } from '../../server';
import { SPOTIFY_FIELDS, fields } from './fields';
import { mapDevices, mapPlayer, mapPlaylists, mapRecent, type SpotifyData } from './map';
import { authorizeUrl, challengeOf, isExpired, parseTokens, randomToken, redirectUriOf, retryAfterSeconds, type Tokens } from './pkce';

const API = 'https://api.spotify.com/v1';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const PENDING_MS = 10 * 60_000;
const ME_TTL = 10 * 60_000;
const RECENT_TTL = 30_000;
const PLAYLISTS_TTL = 5 * 60_000;
const URI_RE = /^spotify:(track|playlist|album|artist):[A-Za-z0-9]{1,64}$/;

interface Stored {
  clientId: string;
  tokens?: Tokens;
}

interface Pending {
  verifier: string;
  redirectUri: string;
  clientId: string;
  at: number;
}

interface Cache<T> {
  at: number;
  value: T;
}

interface Session {
  store: JsonStore<Stored>;
  pending: Map<string, Pending>;
  refreshing?: Promise<Tokens>;
  me?: Cache<{ premium: boolean; user: string }>;
  recent?: Cache<SpotifyData['recent']>;
  playlists?: Cache<SpotifyData['playlists']>;
}

const sessions = new Map<string, Session>();

function sessionOf(dataDir: string): Session {
  let s = sessions.get(dataDir);
  if (!s) {
    const parse = (raw: any): Stored => {
      const t = raw?.tokens;
      const ok = typeof t?.accessToken === 'string' && t.accessToken && typeof t?.refreshToken === 'string' && t.refreshToken;
      return { clientId: typeof raw?.clientId === 'string' ? raw.clientId : '', ...(ok ? { tokens: { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Number(t.expiresAt) || 0 } } : {}) };
    };
    sessions.set(dataDir, (s = { store: createJsonStore({ dataDir, name: 'spotify', parse, empty: () => ({ clientId: '' }) }), pending: new Map() }));
  }
  return s;
}

const notConnected = () => SourceError('not-configured', 'Spotify is not connected.');

async function tokenRequest(body: Record<string, string>, signal?: AbortSignal): Promise<any> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw SourceError('offline', 'Spotify is not reachable.', String((err as Error)?.message ?? err));
  }
  if (res.status === 429) throw SourceError('rate-limited', 'Spotify is limiting requests.', undefined, { seconds: retryAfterSeconds(res.headers.get('retry-after')) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw SourceError(res.status === 400 || res.status === 401 ? 'auth' : 'upstream', `Spotify answered ${res.status}.`, String(json?.error_description ?? json?.error ?? ''));
  return json;
}

/** A valid access token; a token that `stale` names as rejected is refreshed even when it looks valid. */
async function accessToken(ctx: SourceContext, clientId: string, stale?: string): Promise<string> {
  const s = sessionOf(ctx.dataDir);
  const stored = await s.store.read();
  if (!stored.tokens || stored.clientId !== clientId) throw notConnected();
  const t = stored.tokens;
  if (!isExpired(t, Date.now()) && t.accessToken !== stale) return t.accessToken;
  s.refreshing ??= (async () => {
    try {
      const raw = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken, client_id: clientId }, ctx.signal);
      const next = parseTokens(raw, Date.now(), t.refreshToken);
      if (!next) throw SourceError('upstream', 'Spotify returned no token.');
      await s.store.update((v) => ({ ...v, tokens: next }));
      return next;
    } catch (err) {
      if ((err as { code?: string }).code === 'source-auth') {
        await s.store.update((v) => ({ clientId: v.clientId }));
        throw notConnected();
      }
      throw err;
    } finally {
      s.refreshing = undefined;
    }
  })();
  return (await s.refreshing).accessToken;
}

/** Calls the Web API with the stored token: one refresh on 401, errors mapped to source and Spotify codes. */
async function api(ctx: SourceContext, clientId: string, method: string, path: string, body?: unknown, stale?: string): Promise<any> {
  const token = await accessToken(ctx, clientId, stale);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctx.signal,
    });
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    throw SourceError('offline', 'Spotify is not reachable.', String((err as Error)?.message ?? err));
  }
  if (res.status === 401) {
    if (stale) throw notConnected();
    return api(ctx, clientId, method, path, body, token);
  }
  if (res.status === 429) throw SourceError('rate-limited', 'Spotify is limiting requests.', undefined, { seconds: retryAfterSeconds(res.headers.get('retry-after')) });
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return undefined; } })() : undefined;
  if (!res.ok) {
    const reason = json?.error?.reason;
    if (reason === 'PREMIUM_REQUIRED') throw invalid('spotify-premium', 'Spotify Premium is required.');
    if (reason === 'NO_ACTIVE_DEVICE' || (res.status === 404 && method !== 'GET')) throw invalid('spotify-no-device', 'No active Spotify device.');
    throw SourceError(res.status === 403 ? 'auth' : 'upstream', `Spotify answered ${res.status}.`, String(json?.error?.message ?? ''));
  }
  return json;
}

/** `load()` at most once per `ttl`; a failed reload falls back to the last value. */
async function cached<T>(s: Session, key: 'me' | 'recent' | 'playlists', ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = s[key] as Cache<T> | undefined;
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  try {
    const value = await load();
    (s as any)[key] = { at: Date.now(), value };
    return value;
  } catch (err) {
    if (hit) return hit.value;
    throw err;
  }
}

const emptyData = (redirectUri: string, connected: boolean): SpotifyData => ({ connected, redirectUri, premium: false, user: '', devices: [], recent: [], playlists: [] });

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const intIn = (v: unknown, min: number, max: number, code: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(code, 'Invalid value.');
  return Math.min(max, Math.max(min, Math.round(v)));
};
const uriOf = (v: unknown): string => {
  if (typeof v !== 'string' || !URI_RE.test(v)) throw invalid('spotify-uri', 'Invalid Spotify item.');
  return v;
};

type Action = NonNullable<DataSource<{ clientId: string }>['actions']>[string];

const command = (method: string, path: (p: Record<string, unknown>) => string, body?: (p: Record<string, unknown>) => unknown): Action =>
  async (payload, config, ctx) => {
    const p = obj(payload);
    await api(ctx, config.clientId.trim(), method, path(p), body?.(p));
  };

export const spotifySource = defineSource<{ clientId: string }>({
  id: 'spotify',
  fields: SPOTIFY_FIELDS,
  async fetch(config, ctx): Promise<SpotifyData> {
    const clientId = config.clientId.trim();
    if (!clientId) throw SourceError('not-configured', 'Enter the Spotify client ID.');
    const redirectUri = redirectUriOf(ctx.origin ?? 'http://127.0.0.1');
    const s = sessionOf(ctx.dataDir);
    const stored = await s.store.read();
    if (!stored.tokens || stored.clientId !== clientId) return emptyData(redirectUri, false);
    const [me, player, devices] = await Promise.all([
      cached(s, 'me', ME_TTL, async () => {
        const raw = await api(ctx, clientId, 'GET', '/me');
        return { premium: raw?.product === 'premium', user: String(raw?.display_name ?? raw?.id ?? '') };
      }),
      api(ctx, clientId, 'GET', '/me/player'),
      api(ctx, clientId, 'GET', '/me/player/devices'),
    ]);
    const [recent, playlists] = await Promise.all([
      cached(s, 'recent', RECENT_TTL, async () => mapRecent(await api(ctx, clientId, 'GET', '/me/player/recently-played?limit=20'))).catch(() => []),
      cached(s, 'playlists', PLAYLISTS_TTL, async () => mapPlaylists(await api(ctx, clientId, 'GET', '/me/playlists?limit=30'))).catch(() => []),
    ]);
    return { connected: true, redirectUri, ...me, player: mapPlayer(player), devices: mapDevices(devices), recent, playlists };
  },
  actions: {
    async connect(_payload, config, ctx) {
      const clientId = config.clientId.trim();
      if (!clientId) throw SourceError('not-configured', 'Enter the Spotify client ID.');
      const s = sessionOf(ctx.dataDir);
      const now = Date.now();
      for (const [k, v] of s.pending) if (now - v.at > PENDING_MS) s.pending.delete(k);
      const state = randomToken(24);
      const verifier = randomToken();
      const redirectUri = redirectUriOf(ctx.origin ?? 'http://127.0.0.1');
      s.pending.set(state, { verifier, redirectUri, clientId, at: now });
      return { url: authorizeUrl({ clientId, redirectUri, state, challenge: await challengeOf(verifier) }) };
    },
    async disconnect(_payload, _config, ctx) {
      const s = sessionOf(ctx.dataDir);
      s.me = s.recent = s.playlists = undefined;
      await s.store.update((v) => ({ clientId: v.clientId }));
    },
    play: command('PUT', () => '/me/player/play'),
    pause: command('PUT', () => '/me/player/pause'),
    next: command('POST', () => '/me/player/next'),
    previous: command('POST', () => '/me/player/previous'),
    seek: command('PUT', (p) => `/me/player/seek?position_ms=${intIn(p.positionMs, 0, 86_400_000, 'spotify-value')}`),
    volume: command('PUT', (p) => `/me/player/volume?volume_percent=${intIn(p.percent, 0, 100, 'spotify-value')}`),
    shuffle: command('PUT', (p) => `/me/player/shuffle?state=${p.state === true}`),
    repeat: command('PUT', (p) => {
      if (p.state !== 'off' && p.state !== 'context' && p.state !== 'track') throw invalid('spotify-value', 'Invalid value.');
      return `/me/player/repeat?state=${p.state}`;
    }),
    transfer: command('PUT', () => '/me/player', (p) => {
      if (typeof p.deviceId !== 'string' || !p.deviceId) throw invalid('spotify-value', 'Invalid value.');
      return { device_ids: [p.deviceId], play: p.play !== false };
    }),
    'play-uri': command('PUT', () => '/me/player/play', (p) => {
      const uri = uriOf(p.uri);
      return uri.startsWith('spotify:track:') ? { uris: [uri] } : { context_uri: uri };
    }),
    queue: command('POST', (p) => `/me/player/queue?uri=${encodeURIComponent(uriOf(p.uri))}`),
  },
  callbacks: {
    async auth(query, ctx) {
      const page = (status: number, text: string) => new Response(`<!doctype html><meta charset="utf-8"><title>Kedalion</title><body style="font-family:system-ui;padding:2em"><p>${text}</p>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
      const s = sessionOf(ctx.dataDir);
      const state = query.get('state') ?? '';
      const pending = s.pending.get(state);
      s.pending.delete(state);
      const code = query.get('code');
      if (!pending || Date.now() - pending.at > PENDING_MS) return page(400, 'This Spotify sign-in link expired. Go back to Kedalion and press Connect again.');
      if (!code) return page(400, 'Spotify did not authorize Kedalion. Go back to Kedalion and press Connect again.');
      try {
        const raw = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri, client_id: pending.clientId, code_verifier: pending.verifier }, ctx.signal);
        const tokens = parseTokens(raw, Date.now());
        if (!tokens) return page(502, 'Spotify returned no token. Try again.');
        s.me = s.recent = s.playlists = undefined;
        await s.store.update(() => ({ clientId: pending.clientId, tokens }));
      } catch (err) {
        return page(502, `Could not finish connecting: ${String((err as Error)?.message ?? err).replace(/[<&]/g, '')}`);
      }
      return page(200, 'Spotify is connected. You can close this tab and return to Kedalion.');
    },
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'spotify', fields: fields.spotify!, allowMultiple: false }];
export const sources: DataSource<any>[] = [spotifySource];
