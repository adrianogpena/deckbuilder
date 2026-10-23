import type { PanelField } from '@deckbuilderkit/ui/grid';

export const CONTAINERS_FIELDS: readonly PanelField[] = [
  { key: 'engine', kind: 'enum', label: 'dash.containers.engine', default: 'podman', values: ['podman', 'docker'] },
  { key: 'pinned', kind: 'text', label: 'dash.containers.pinned', description: 'dash.containers.pinned.hint', default: '', rows: 4, maxLength: 2000 },
  { key: 'showStopped', kind: 'boolean', label: 'dash.containers.showStopped', default: true },
];

export const fields: Record<string, readonly PanelField[]> = { containers: CONTAINERS_FIELDS };
