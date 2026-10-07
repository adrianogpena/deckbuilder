// Shared by the server and the web UI; keep this file free of runtime imports.

/** Header the web UI sends with the session token. */
export const TOKEN_HEADER = 'x-deckbase-token';

/** URL parameter that hands the token to a new window; the UI moves it into sessionStorage. */
export const TOKEN_PARAM = 't';

/** Fixed port and token of `--dev` runs; Vite (port 5173) proxies /api to this port. */
export const DEV_PORT = 7420;
export const DEV_TOKEN = 'dev';
export const VITE_PORT = 5173;

/** JSON body of every failed API call. */
export interface ApiErrorBody {
  kind: string;
  /** Message id for translation (`error.<code>`); "raw" means `message` is shown as-is. */
  code?: string;
  /** English fallback. */
  message: string;
  params?: Record<string, string | number>;
  /** Raw tool output; never translated. */
  detail?: string;
}

/** Identity of an app; each app defines one in its `app.ts`. */
export interface AppIdentity {
  /** Display name: window title, sidebar, terminal output, release file names. */
  name: string;
  /** Lowercase id: data folder (~/.<id>), executable name in help text. */
  id: string;
}
