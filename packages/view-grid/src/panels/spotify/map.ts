export interface Track {
  uri: string;
  name: string;
  artists: string;
  album: string;
  durationMs: number;
  image: string;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  active: boolean;
  volume: number;
}

export interface Playlist {
  uri: string;
  name: string;
  owner: string;
  tracks: number;
  image: string;
}

export interface Player {
  track?: Track;
  playing: boolean;
  progressMs: number;
  shuffle: boolean;
  repeat: 'off' | 'context' | 'track';
  volume: number;
  device?: Device;
}

export interface SpotifyData {
  connected: boolean;
  redirectUri: string;
  premium: boolean;
  user: string;
  player?: Player;
  devices: Device[];
  recent: Track[];
  playlists: Playlist[];
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The smallest image that is at least 64 px wide, else the first one. */
export function pickImage(images: unknown): string {
  const list = (Array.isArray(images) ? images : []).filter((i) => typeof i?.url === 'string');
  const sorted = [...list].sort((a, b) => num(a.width) - num(b.width));
  return text((sorted.find((i) => num(i.width) >= 64) ?? sorted[0])?.url);
}

export function mapTrack(raw: any): Track | undefined {
  if (!raw || typeof raw.uri !== 'string' || raw.type === 'episode') return undefined;
  return {
    uri: raw.uri,
    name: text(raw.name),
    artists: (Array.isArray(raw.artists) ? raw.artists : []).map((a: any) => text(a?.name)).filter(Boolean).join(', '),
    album: text(raw.album?.name),
    durationMs: num(raw.duration_ms),
    image: pickImage(raw.album?.images),
  };
}

export function mapDevice(raw: any): Device | undefined {
  if (!raw || typeof raw.id !== 'string') return undefined;
  return { id: raw.id, name: text(raw.name), type: text(raw.type), active: raw.is_active === true, volume: num(raw.volume_percent) };
}

export const mapDevices = (raw: any): Device[] => (Array.isArray(raw?.devices) ? raw.devices : []).flatMap((d: unknown) => mapDevice(d) ?? []);

/** `GET /me/player` (an empty 204 body is `undefined`): no device means no player. */
export function mapPlayer(raw: any): Player | undefined {
  const device = mapDevice(raw?.device);
  if (!raw || !device) return undefined;
  const repeat = raw.repeat_state === 'context' || raw.repeat_state === 'track' ? raw.repeat_state : 'off';
  return {
    track: mapTrack(raw.item),
    playing: raw.is_playing === true,
    progressMs: num(raw.progress_ms),
    shuffle: raw.shuffle_state === true,
    repeat,
    volume: device.volume,
    device,
  };
}

/** `GET /me/player/recently-played`, without episodes and without repeats of the same track in a row. */
export function mapRecent(raw: any): Track[] {
  const tracks = (Array.isArray(raw?.items) ? raw.items : []).flatMap((i: any) => mapTrack(i?.track) ?? []);
  return tracks.filter((t: Track, i: number) => i === 0 || t.uri !== tracks[i - 1]!.uri);
}

export function mapPlaylists(raw: any): Playlist[] {
  return (Array.isArray(raw?.items) ? raw.items : []).flatMap((p: any): Playlist[] =>
    p && typeof p.uri === 'string'
      ? [{ uri: p.uri, name: text(p.name), owner: text(p.owner?.display_name), tracks: num(p.tracks?.total ?? p.items?.total), image: pickImage(p.images) }]
      : [],
  );
}

/** The next repeat state of the cycle off, context, track. */
export const nextRepeat = (r: Player['repeat']): Player['repeat'] => (r === 'off' ? 'context' : r === 'context' ? 'track' : 'off');

export const fmtClock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
