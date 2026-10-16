import { httpClient, type HttpClient } from '@deckbuilderkit/editor';
import { request } from '@deckbuilderkit/ui';
import type { RestEnvironment, RestEnvironmentInput, RestHistoryEntry } from '@deckbuilderkit/server-core/protocol';
import type { RestTabsFile, SavedRequest } from './settings';

/** The server calls the REST view makes (the sending and the environment list come from `HttpClient`); the app builds it from its api and passes it to `restView`. */
export interface RestClient extends HttpClient {
  requests: () => Promise<SavedRequest[]>;
  createRequest: (input: Record<string, unknown>) => Promise<SavedRequest>;
  updateRequest: (id: string, input: Record<string, unknown>) => Promise<SavedRequest>;
  deleteRequest: (id: string) => Promise<unknown>;
  reorderRequests: (ids: string[]) => Promise<unknown>;
  /** The saved Authorization value of request `id`, for Copy as curl. */
  requestAuth: (id: string) => Promise<{ value: string | null }>;
  /** Picks a file on the server side; `text` is null when the dialog was cancelled. */
  importRequestsFile: () => Promise<{ name?: string; text: string | null }>;
  saveCurl: (text: string) => Promise<{ path: string | null }>;
  /** Saves the body of the sent response `id`; `path` is null when the dialog was cancelled. */
  httpSave: (id: string) => Promise<{ path: string | null; bytes?: number }>;
  restTabs: () => Promise<RestTabsFile>;
  saveRestTabs: (file: RestTabsFile) => Promise<unknown>;
  createRestEnvironment: (input: RestEnvironmentInput) => Promise<RestEnvironment>;
  updateRestEnvironment: (id: string, input: RestEnvironmentInput) => Promise<RestEnvironment>;
  deleteRestEnvironment: (id: string) => Promise<unknown>;
  /** Sent requests, newest first; `q` matches method and URL. */
  restHistory: (q?: string) => Promise<RestHistoryEntry[]>;
  clearRestHistory: () => Promise<unknown>;
}

let current: RestClient | undefined;

/** Set by `restView`; the tabs store and the dialogs call the server through `restApi`. */
export const bindRestClient = (client: RestClient) => {
  current = client;
};

export const restApi: RestClient = new Proxy({} as RestClient, {
  get(_, key) {
    if (!current) throw new Error('The REST client is not bound');
    return current[key as keyof RestClient];
  },
});

/** The default `RestClient`: the server's `/api/requests`, `/api/rest*` and `/api/http/*` routes over fetch. */
export const restClient: RestClient = {
  ...httpClient,
  requests: () => request<SavedRequest[]>('GET', '/api/requests'),
  createRequest: (input) => request<SavedRequest>('POST', '/api/requests', {}, input),
  updateRequest: (id, input) => request<SavedRequest>('PUT', '/api/requests', { id }, input),
  deleteRequest: (id) => request<{ ok: true }>('DELETE', '/api/requests', { id }),
  reorderRequests: (ids) => request<{ ok: true }>('POST', '/api/requests/order', {}, { ids }),
  requestAuth: (id) => request<{ value: string | null }>('GET', '/api/requests/auth', { id }),
  importRequestsFile: () => request<{ name?: string; text: string | null }>('POST', '/api/requests/import-file'),
  saveCurl: (text) => request<{ path: string | null }>('POST', '/api/requests/save-curl', {}, { text }),
  httpSave: (id) => request<{ path: string | null; bytes?: number }>('POST', '/api/http/save', {}, { id }),
  restTabs: () => request<RestTabsFile>('GET', '/api/rest-tabs'),
  saveRestTabs: (file) => request<{ ok: true }>('PUT', '/api/rest-tabs', {}, file),
  createRestEnvironment: (input) => request<RestEnvironment>('POST', '/api/rest/environments', {}, input),
  updateRestEnvironment: (id, input) => request<RestEnvironment>('PUT', '/api/rest/environments', { id }, input),
  deleteRestEnvironment: (id) => request<{ ok: true }>('DELETE', '/api/rest/environments', { id }),
  restHistory: (q = '') => request<RestHistoryEntry[]>('GET', '/api/rest/history', q ? { q } : {}),
  clearRestHistory: () => request<{ ok: true }>('DELETE', '/api/rest/history'),
};
