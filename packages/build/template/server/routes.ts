import type { Routes } from '@deckbuilderkit/server-core';
import type { StartContext } from '@deckbuilderkit/shell';

/**
 * This app's own endpoints. Keys are "METHOD /path"; handlers return a JSON-serializable value
 * or throw an AppError (`invalid`, `notFound`) that the UI shows translated as `error.<code>`.
 */
export const routes = (_ctx: StartContext): Routes => ({
  // 'GET /api/things': async () => [],
});
