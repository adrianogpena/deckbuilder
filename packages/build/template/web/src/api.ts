import type { ThemeSettings } from '@deckbuilder/server-core/palettes';
import type { UpdateState } from '@deckbuilder/server-core/protocol';
import { type Keymap, type Language, request } from '@deckbuilder/ui';

export interface Settings extends ThemeSettings {
  language?: Language;
  /** The main menu shows only its icons. */
  /** Keybinding overrides by command id; the server validates it. */
  keybindings?: Keymap;
  autostart: boolean;
  /** Tray icon; read at startup. */
  closeToTray: boolean;
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
  /** Shows the server's folder dialog and saves the result as `updateFolder` (unchanged when cancelled). */
  pickUpdateFolder: (title: string) => request<Settings>('POST', '/api/settings/update-folder', {}, { title }),
  update: () => request<UpdateState>('GET', '/api/update'),
  checkUpdate: () => request<UpdateState>('POST', '/api/update/check'),
  applyUpdate: () => request<{ version: string }>('POST', '/api/update/apply'),
  quit: () => request<{ ok: true }>('POST', '/api/quit'),
};
