import type { UpdateState } from '@deckbuilder/server-core/protocol';
import { type Language, request } from '@deckbuilder/ui';

export interface Settings {
  theme: 'dark' | 'light';
  language?: Language;
  autostart: boolean;
  updateFolder: string;
}

/** GET /api/info (infoRoutes in @deckbuilder/server-mods). */
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
  update: () => request<UpdateState>('GET', '/api/update'),
  checkUpdate: () => request<UpdateState>('POST', '/api/update/check'),
  applyUpdate: () => request<{ version: string }>('POST', '/api/update/apply'),
  quit: () => request<{ ok: true }>('POST', '/api/quit'),
  testToast: () => request<{ ok: true }>('POST', '/api/toast/test'),
  echo: (text: string) => request<{ text: string; length: number; at: string }>('POST', '/api/echo', {}, { text }),
};
