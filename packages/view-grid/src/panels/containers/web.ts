import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { CONTAINERS_FIELDS } from './fields';
import { ContainersPanel, type ContainersConfig, type ContainersPanelData } from './ContainersPanel';

const containersPanel = definePanel<ContainersConfig, ContainersPanelData>({
  kind: 'containers',
  title: 'dash.containers.panel',
  description: 'dash.containers.panel.description',
  icon: 'cube',
  category: 'dash.category.containers',
  size: { w: 10, h: 10, minW: 5, minH: 4 },
  config: { fields: CONTAINERS_FIELDS },
  load: (config) => fetchSource<ContainersPanelData>('containers', config),
  refreshMs: 30_000,
  allowMultiple: true,
  render: ({ config, data, refresh }) => createElement(ContainersPanel, { config, data, refresh }),
});

export const panels: AnyPanelKind[] = [containersPanel];
