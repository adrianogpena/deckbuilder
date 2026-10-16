import type { HttpClient } from '@deckbuilder/editor';
import type { RestEnvironment, RestEnvironmentInput, RestHistoryEntry } from '@deckbuilder/server-core/protocol';
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
