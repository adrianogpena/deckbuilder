import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { PODS_FIELDS } from './fields';
import { PodsPanel, type PodsConfig, type PodsPanelData } from './PodsPanel';
import type { Pod } from './model';

/** Set by the Logs step to open its viewer; the Pods panel shows a Logs entry once it is set. */
let onLogs: ((pod: Pod) => void) | undefined;
export const setPodsLogsHandler = (fn: ((pod: Pod) => void) | undefined): void => {
  onLogs = fn;
};

const podsPanel = definePanel<PodsConfig, PodsPanelData>({
  kind: 'pods',
  title: 'dash.pods.panel',
  description: 'dash.pods.panel.description',
  icon: 'cube',
  category: 'dash.category.pods',
  size: { w: 10, h: 12, minW: 5, minH: 5 },
  config: { fields: PODS_FIELDS },
  load: (config) => fetchSource<PodsPanelData>('pods', config),
  refreshMs: (config) => Math.max(5, config.refreshSec || 30) * 1000,
  allowMultiple: true,
  render: ({ config, data, refresh }) => createElement(PodsPanel, { config, data, refresh, onLogs }),
});

export const panels: AnyPanelKind[] = [podsPanel];
