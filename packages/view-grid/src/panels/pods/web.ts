import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { PODS_FIELDS } from './fields';
import { type PodsConfig, type PodsPanelData } from './PodsPanel';
import { PodsWithLogs } from './PodLogsDialog';
import { PodsActions } from './PodsActions';
import { PodsConfigEditor } from './PodsConfigEditor';


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
  headerActions: PodsActions,
  configEditor: PodsConfigEditor,
  render: ({ config, data, refresh }) => createElement(PodsWithLogs, { config, data, refresh }),
});

export const panels: AnyPanelKind[] = [podsPanel];
