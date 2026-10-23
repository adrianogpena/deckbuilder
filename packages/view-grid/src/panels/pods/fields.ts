import type { PanelField } from '@deckbuilderkit/ui/grid';

export const PODS_FIELDS: readonly PanelField[] = [
  { key: 'clusters', kind: 'text', label: 'dash.pods.clusters', description: 'dash.pods.clusters.hint', placeholder: 'dash.pods.clusters.placeholder', default: '', rows: 4, maxLength: 2000 },
  { key: 'refreshSec', kind: 'number', label: 'dash.pods.refreshSec', default: 30, min: 5, max: 3600 },
  { key: 'showHealthy', kind: 'boolean', label: 'dash.pods.showHealthy', default: true },
];

export const fields: Record<string, readonly PanelField[]> = { pods: PODS_FIELDS };
