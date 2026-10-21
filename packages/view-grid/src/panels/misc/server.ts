import type { PanelConfig } from '@deckbuilderkit/ui/grid';
import type { DataSource, GridPanelSpec } from '../../server';
import { fields } from './fields';
import { checkUrl, fetchJson, type HealthResult } from './health';
import { asNumber, lookupPath } from './jsonpath';
import { parseLines } from './lines';
import { MAX_URLS } from './fields';
import { systemStats, type SystemStats } from './system';

export const specs: GridPanelSpec[] = [
  { kind: 'links', fields: fields.links, allowMultiple: true },
  { kind: 'notes', fields: fields.notes, allowMultiple: true },
  { kind: 'url-health', fields: fields['url-health'], allowMultiple: true },
  { kind: 'json-metric', fields: fields['json-metric'], allowMultiple: true },
  { kind: 'system', fields: fields.system, allowMultiple: false },
];

export interface JsonMetricData {
  /** Undefined when the path is missing or not a number. */
  value: number | undefined;
  /** The raw value, shown when it is not numeric. */
  raw?: string;
}

const urlHealth: DataSource<PanelConfig> = {
  id: 'url-health',
  fields: fields['url-health']!,
  async fetch(config, ctx): Promise<HealthResult[]> {
    const items = parseLines(String(config.urls ?? ''), MAX_URLS);
    return Promise.all(items.map((i) => checkUrl(i.label, i.url, Number(config.timeoutMs), ctx.signal)));
  },
};

const jsonMetric: DataSource<PanelConfig> = {
  id: 'json-metric',
  fields: fields['json-metric']!,
  async fetch(config, ctx): Promise<JsonMetricData> {
    const found = lookupPath(await fetchJson(String(config.url ?? ''), 10_000, ctx.signal), String(config.path ?? ''));
    const value = asNumber(found);
    const raw = value === undefined && found !== undefined ? (typeof found === 'object' ? JSON.stringify(found) : String(found)).slice(0, 200) : undefined;
    return { value, ...(raw !== undefined && { raw }) };
  },
};

const system: DataSource<PanelConfig> = {
  id: 'system',
  fields: fields.system!,
  fetch: (_config, ctx): Promise<SystemStats> => systemStats(ctx.dataDir),
};

/** Server data sources of the misc panels (no React). */
export const sources: DataSource<any>[] = [urlHealth, jsonMetric, system];
