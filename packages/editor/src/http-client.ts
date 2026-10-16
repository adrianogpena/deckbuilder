import type { HttpRequestDraft, HttpRequestSpec, HttpResponseInfo, RestEnvironment } from '@deckbuilder/server-core/protocol';

/** The server calls the REST/curl views make; the app builds it from its api and passes it to them. */
export interface HttpClient {
  /** Sends `request` after substituting `{{name}}` from `environment` (id; omitted = built-ins only); `draft` is the unresolved editor draft for the history. */
  send: (request: HttpRequestSpec, secretRef: string | undefined, signal: AbortSignal, env?: { environment?: string; draft?: HttpRequestDraft }) => Promise<HttpResponseInfo>;
  /** REST environments; secret variables come back with `value: ''` and `set`. */
  environments: () => Promise<RestEnvironment[]>;
}
