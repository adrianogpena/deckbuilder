import type { PanelField } from '@kedalion/ui/grid';

export const SPOTIFY_FIELDS: readonly PanelField[] = [
  { key: 'clientId', kind: 'string', label: 'dash.spotify.clientId', description: 'dash.spotify.clientId.hint', placeholder: 'dash.spotify.clientId.placeholder', default: '', maxLength: 64 },
];

/** Config field lists of the Spotify panel (no React), by kind. */
export const fields: Record<string, readonly PanelField[]> = { spotify: SPOTIFY_FIELDS };
