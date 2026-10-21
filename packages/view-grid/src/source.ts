import { request, type PanelConfig } from '@deckbuilderkit/ui';

/** Calls the server's data source `id` (see `defineSource`) with the panel's config; for a kind's `load`. */
export const fetchSource = <T = unknown>(id: string, config: PanelConfig): Promise<T> =>
  request<T>('POST', `/api/grid/source/${encodeURIComponent(id)}`, {}, { config });
