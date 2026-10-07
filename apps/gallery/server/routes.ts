import { createToaster } from '@deckbuilder/platform';
import { invalid, type Routes } from '@deckbuilder/server-core';
import type { StartContext } from '@deckbuilder/shell';
import { APP } from '../app.ts';

/** Set by `onStart` in main.ts; routes only run after the server started, so it is there by then. */
let start: StartContext | undefined;
export const setStartContext = (ctx: StartContext) => {
  start = ctx;
};

const toaster = createToaster();

/**
 * This app's own endpoints. Keys are "METHOD /path"; handlers return a JSON-serializable value
 * or throw an AppError (`invalid`, `notFound`) that the UI shows translated as `error.<code>`.
 */
export const routes: Routes = {
  // Example endpoint; delete it once real ones exist.
  'POST /api/echo': async ({ json }) => {
    const body = await json<{ text?: unknown }>();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw invalid('emptyText', 'Type something first.');
    return { text, length: text.length, at: new Date().toISOString() };
  },
  // Example notification: a click opens the app on the Settings screen.
  'POST /api/toast/test': () => {
    if (start) toaster.show({ title: APP.name, body: 'Click to open the Settings screen.', launch: start.link('settings') });
    return { ok: true };
  },
};
