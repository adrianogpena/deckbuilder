import type { ThemeSettings } from '@deckbuilder/server-core/palettes';
import type { UpdateState } from '@deckbuilder/server-core/protocol';
import { type Language, request } from '@deckbuilder/ui';

export interface Settings extends ThemeSettings {
  language?: Language;
  autostart: boolean;
  /** Tray icon; read at startup. */
  closeToTray: boolean;
  updateFolder: string;
  /** Layout of the Tabs screen; restored (and validated) by the screen. */
  tabsLayout?: unknown;
  /** Layout of the Grid screen (`GridItem[]`); the server validates it. */
  gridLayout?: unknown;
  /** State of the Explorer screen; the server validates it. */
  explorer?: ExplorerSettings;
  /** State of the Workbench screen; the server validates it. */
  workbench?: WorkbenchSettings;
}

export interface WorkbenchSettings {
  sizes?: { main: [number, number]; results: [number, number] };
  widths?: Record<string, number>;
}

export interface DemoRow {
  id: number;
  name: string;
  amount: number;
  date: string;
}

export interface DemoSecret {
  id: string;
  token?: { hasSecret: true };
}

export interface ExplorerSettings {
  /** Fractions of the sidebar and the workspace. */
  sizes: [number, number];
  collapsed: boolean;
  /** Expanded tree node ids per project id; a project with an entry is open in the sidebar. */
  expanded: Record<string, string[]>;
  tabs?: unknown;
}

export interface Project {
  id: string;
  name: string;
  path: string;
}

export interface FsEntry {
  name: string;
  kind: 'file' | 'dir' | 'link';
  size: number;
  mtime: number;
  /** A link that leads out of the project folder. */
  outside?: boolean;
}

export type FsRead = { text: string; size: number; mtime: number; truncated: boolean } | { binary: true; size: number; mtime: number };

export interface SearchHit {
  path: string;
  kind: 'file' | 'dir' | 'link';
  line?: number;
  text?: string;
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
  projects: () => request<Project[]>('GET', '/api/projects'),
  createProject: (input: Record<string, unknown>) => request<Project>('POST', '/api/projects', {}, input),
  updateProject: (id: string, input: Record<string, unknown>) => request<Project>('PUT', '/api/projects', { id }, input),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', '/api/projects', { id }),
  fsList: (root: string, path: string) => request<{ entries: FsEntry[] }>('GET', '/api/fs/list', { root, path }).then((r) => r.entries),
  fsRead: (root: string, path: string) => request<FsRead>('GET', '/api/fs/read', { root, path }),
  fsCreate: (root: string, path: string, kind: 'file' | 'dir') => request<FsEntry>('POST', '/api/fs/create', {}, { root, path, kind }),
  fsWrite: (root: string, path: string, text: string, expectedMtime: number) =>
    request<FsEntry>('POST', '/api/fs/write', {}, { root, path, text, expectedMtime }),
  fsRename: (root: string, path: string, name: string) => request<FsEntry>('POST', '/api/fs/rename', {}, { root, path, name }),
  fsMove: (root: string, from: string, to: string) => request<FsEntry>('POST', '/api/fs/move', {}, { root, from, to }),
  fsDelete: (root: string, paths: string[]) => request<{ ok: true }>('POST', '/api/fs/delete', {}, { root, paths }),
  fsReveal: (root: string, path: string) => request<{ ok: true }>('POST', '/api/fs/reveal', {}, { root, path }),
  fsOpen: (root: string, path: string) => request<{ ok: true }>('POST', '/api/fs/open', {}, { root, path }),
  saveTarget: () => request<{ path: string | null }>('POST', '/api/demo/save-target'),
  saveDemo: (path: string, text: string) => request<{ ok: true }>('POST', '/api/demo/save', {}, { path, text }),
  demoSecrets: () => request<DemoSecret[]>('GET', '/api/demo/secrets'),
  createDemoSecret: (input: Record<string, unknown>) => request<DemoSecret>('POST', '/api/demo/secrets', {}, input),
  updateDemoSecret: (id: string, input: Record<string, unknown>) => request<DemoSecret>('PUT', '/api/demo/secrets', { id }, input),
  echo: (text: string) => request<{ text: string; length: number; at: string }>('POST', '/api/echo', {}, { text }),
};
