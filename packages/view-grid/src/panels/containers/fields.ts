import type { PanelField } from '@kedalion/ui/grid';
import { notifyField } from '../../notify-field';

export const CONTAINERS_FIELDS: readonly PanelField[] = [
  { key: 'engine', kind: 'enum', label: 'dash.containers.engine', default: 'podman', values: ['podman', 'docker'] },
  { key: 'pinned', kind: 'text', label: 'dash.containers.pinned', description: 'dash.containers.pinned.hint', default: '', rows: 4, maxLength: 2000 },
  { key: 'showStopped', kind: 'boolean', label: 'dash.containers.showStopped', default: true },
  notifyField(true),
];

export const fields: Record<string, readonly PanelField[]> = { containers: CONTAINERS_FIELDS };
