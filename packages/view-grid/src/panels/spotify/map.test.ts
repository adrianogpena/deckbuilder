import { describe, expect, test } from 'bun:test';
import { fmtClock, mapDevices, mapPlayer, mapPlaylists, mapRecent, mapTrack, nextRepeat, pickImage } from './map';

const track = (uri: string) => ({ uri, name: 'Song', type: 'track', duration_ms: 1000, artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Alb', images: [{ url: 'big', width: 640 }, { url: 'small', width: 64 }] } });

describe('spotify map', () => {
  test('track joins artists and picks the small image', () => {
    expect(mapTrack(track('u1'))).toEqual({ uri: 'u1', name: 'Song', artists: 'A, B', album: 'Alb', durationMs: 1000, image: 'small' });
    expect(mapTrack({ ...track('u2'), type: 'episode' })).toBeUndefined();
    expect(pickImage(undefined)).toBe('');
  });

  test('player needs a device', () => {
    expect(mapPlayer(undefined)).toBeUndefined();
    const raw = { device: { id: 'd', name: 'PC', type: 'Computer', is_active: true, volume_percent: 40 }, is_playing: true, progress_ms: 500, shuffle_state: true, repeat_state: 'track', item: track('u1') };
    expect(mapPlayer(raw)).toMatchObject({ playing: true, progressMs: 500, shuffle: true, repeat: 'track', volume: 40, device: { id: 'd', active: true } });
  });

  test('devices skip entries without id', () => {
    expect(mapDevices({ devices: [{ id: 'a', name: 'X' }, { name: 'no id' }] }).map((d) => d.id)).toEqual(['a']);
  });

  test('recent drops episodes and consecutive repeats', () => {
    const raw = { items: [{ track: track('a') }, { track: track('a') }, { track: { ...track('e'), type: 'episode' } }, { track: track('b') }] };
    expect(mapRecent(raw).map((t) => t.uri)).toEqual(['a', 'b']);
  });

  test('playlists', () => {
    const raw = { items: [{ uri: 'p', name: 'Mix', owner: { display_name: 'Me' }, tracks: { total: 7 }, images: [] }, null] };
    expect(mapPlaylists(raw)).toEqual([{ uri: 'p', name: 'Mix', owner: 'Me', tracks: 7, image: '' }]);
  });

  test('repeat cycle and clock', () => {
    expect(nextRepeat('off')).toBe('context');
    expect(nextRepeat('track')).toBe('off');
    expect(fmtClock(65_000)).toBe('1:05');
  });
});
