import { createElement } from 'react';
import { definePanel, type AnyPanelKind } from '../../panel';
import { fetchSource } from '../../source';
import { fields } from './fields';
import type { HealthResult } from './health';
import { JsonMetric } from './JsonMetric';
import { Links } from './Links';
import { Notes } from './Notes';
import type { JsonMetricData } from './server';
import { System } from './SystemTiles';
import type { SystemStats } from './system';
import { UrlHealth } from './UrlHealth';

const CATEGORY = 'dash.category.misc';
const minutes = (config: { refreshMin?: unknown }): number => Number(config.refreshMin) * 60_000;

const linksPanel = definePanel<{ items: string; layout: string }>({
  kind: 'links',
  title: 'dash.misc.links',
  description: 'dash.misc.links.description',
  icon: 'link',
  category: CATEGORY,
  size: { w: 8, h: 10, minW: 4, minH: 4 },
  config: { fields: fields.links! },
  allowMultiple: true,
  render: ({ config }) => createElement(Links, { items: config.items, layout: config.layout }),
});

const notesPanel = definePanel<{ text: string }>({
  kind: 'notes',
  title: 'dash.misc.notes',
  description: 'dash.misc.notes.description',
  icon: 'markdown',
  category: CATEGORY,
  size: { w: 8, h: 12, minW: 4, minH: 4 },
  config: { fields: fields.notes! },
  allowMultiple: true,
  render: ({ config, configure }) => createElement(Notes, { text: config.text, configure }),
});

const urlHealthPanel = definePanel<{ urls: string; layout: string; timeoutMs: number; refreshMin: number }, HealthResult[]>({
  kind: 'url-health',
  title: 'dash.misc.health',
  description: 'dash.misc.health.description',
  icon: 'check',
  category: CATEGORY,
  size: { w: 8, h: 10, minW: 4, minH: 4 },
  config: { fields: fields['url-health']! },
  allowMultiple: true,
  load: (config) => fetchSource<HealthResult[]>('url-health', config),
  refreshMs: minutes,
  render: ({ config, data }) => createElement(UrlHealth, { results: data, layout: config.layout }),
});

const jsonMetricPanel = definePanel<{ url: string; path: string; label: string; unit: string; refreshMin: number }, JsonMetricData>({
  kind: 'json-metric',
  title: 'dash.misc.json',
  description: 'dash.misc.json.description',
  icon: 'braces',
  category: CATEGORY,
  size: { w: 6, h: 8, minW: 3, minH: 4 },
  config: { fields: fields['json-metric']! },
  allowMultiple: true,
  load: (config) => fetchSource<JsonMetricData>('json-metric', config),
  refreshMs: minutes,
  render: ({ config, data }) => createElement(JsonMetric, { data, label: config.label, unit: config.unit }),
});

const systemPanel = definePanel<{ show: string[]; layout: string }, SystemStats>({
  kind: 'system',
  title: 'dash.misc.system',
  description: 'dash.misc.system.description',
  icon: 'drive',
  category: CATEGORY,
  size: { w: 10, h: 8, minW: 4, minH: 4 },
  config: { fields: fields.system! },
  allowMultiple: false,
  load: (config) => fetchSource<SystemStats>('system', config),
  refreshMs: 10_000,
  render: ({ config, data }) => createElement(System, { data, config }),
});

/** The misc panel kinds. */
export const panels: AnyPanelKind[] = [linksPanel, notesPanel, urlHealthPanel, jsonMetricPanel, systemPanel];
