import { createToaster } from '@deckbuilder/platform';
import { invalid, type Routes } from '@deckbuilder/server-core';
import type { StartContext } from '@deckbuilder/shell';
import { APP } from '../app.ts';

const toaster = createToaster();

/**
 * This app's own endpoints. Keys are "METHOD /path"; handlers return a JSON-serializable value
 * or throw an AppError (`invalid`, `notFound`) that the UI shows translated as `error.<code>`.
 */
export const routes = (ctx: StartContext): Routes => ({
  // Example endpoint; delete it once real ones exist.
  'POST /api/echo': async ({ json }) => {
    const body = await json<{ text?: unknown }>();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw invalid('emptyText', 'Type something first.');
    return { text, length: text.length, at: new Date().toISOString() };
  },
  // Example notification: a click opens the app on the Settings screen.
  'POST /api/toast/test': () => {
    toaster.show({ title: APP.name, body: 'Click to open the Settings screen.', launch: ctx.link('settings') });
    return { ok: true };
  },
});
