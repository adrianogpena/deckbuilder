import { type Language, request } from '@deckbase/ui';

export interface Settings {
  theme: 'dark' | 'light';
  language?: Language;
}

/** GET /api/info (infoRoutes in @deckbase/server-mods). */
export interface Info {
  name: string;
  version: string;
  platform: string;
  arch: string;
  hostname: string;
  bun: string;
  dataDir: string;
  startedAt: string;
}

export const api = {
  info: () => request<Info>('GET', '/api/info'),
  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (patch: Partial<Settings>) => request<Settings>('PUT', '/api/settings', {}, patch),
  echo: (text: string) => request<{ text: string; length: number; at: string }>('POST', '/api/echo', {}, { text }),
};
