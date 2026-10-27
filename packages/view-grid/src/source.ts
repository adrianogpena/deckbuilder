import { request, stream, type PanelConfig } from '@kedalion/ui';

/** Calls the server's data source `id` (see `defineSource`) with the panel's config; for a kind's `load`. */
export const fetchSource = <T = unknown>(id: string, config: PanelConfig, signal?: AbortSignal): Promise<T> =>
  request<T>('POST', `/api/grid/source/${encodeURIComponent(id)}`, {}, { config }, { signal });

/** Runs action `name` of data source `id` with the panel's config and a payload. */
export const runAction = <T = unknown>(id: string, name: string, config: PanelConfig, payload?: unknown, signal?: AbortSignal): Promise<T> =>
  request<T>('POST', `/api/grid/action/${encodeURIComponent(id)}/${encodeURIComponent(name)}`, {}, { config, payload }, { signal });

/** Reads stream `name` of data source `id`, calling `onItem` per item; resolves at the end or rejects (abort included). */
export const streamSource = (id: string, name: string, params: Record<string, string | number | boolean | undefined>, onItem: (item: unknown) => void, signal?: AbortSignal): Promise<void> =>
  stream(`/api/grid/stream/${encodeURIComponent(id)}/${encodeURIComponent(name)}`, params, onItem, signal);
