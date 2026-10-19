import type { ThemeSettings } from '@deckbuilderkit/server-core/palettes';
import type { UpdateState } from '@deckbuilderkit/server-core/protocol';
import type { ViewSettings } from './view-settings';
import { type Keymap, type Language, request } from '@deckbuilderkit/ui';

export interface Settings extends ThemeSettings, ViewSettings {
  language?: Language;
  /** The main menu shows only its icons. */
  /** Keybinding overrides by command id; the server validates it. */
  keybindings?: Keymap;
  autostart: boolean;
  /** Tray icon; read at startup. */
  closeToTray: boolean;
  updateFolder: string;
}

/** GET /api/info (infoRoutes in @deckbuilderkit/server-mods). */
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
  openSettingsFile: () => request<{ ok: true }>('POST', '/api/settings/open-file'),
  externalSettings: () => request<{ changed: boolean; settings: Settings }>('GET', '/api/settings/external'),
  /** Shows the server's folder dialog and saves the result as `updateFolder` (unchanged when cancelled). */
  pickUpdateFolder: (title: string) => request<Settings>('POST', '/api/settings/update-folder', {}, { title }),
  update: () => request<UpdateState>('GET', '/api/update'),
  checkUpdate: () => request<UpdateState>('POST', '/api/update/check'),
  applyUpdate: () => request<{ version: string }>('POST', '/api/update/apply'),
  quit: () => request<{ ok: true }>('POST', '/api/quit'),
};
