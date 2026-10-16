import { createToaster, saveFileAs, writeFileAtomic } from '@deckbuilderkit/platform';
import { forbidden, invalid, ndjson, type Routes } from '@deckbuilderkit/server-core';
import { fromPlatform, pickedPaths } from '@deckbuilderkit/server-mods';
import type { StartContext } from '@deckbuilderkit/shell';
import { APP } from '../app.ts';

const toaster = createToaster();

const MAX_DEMO_ROWS = 100_000;
const DEMO_BATCH = 500;
const DEMO_PAUSE_MS = 20;
/** Paths the save dialog returned and `/api/demo/save` may still write once. */
const saveTargets = pickedPaths();

/**
 * This app's own endpoints. Keys are "METHOD /path"; handlers return a JSON-serializable value
 * or throw an AppError (`invalid`, `notFound`) that the UI shows translated as `error.<code>`.
 */
export const routes = (ctx: StartContext): Routes => ({
  'GET /api/demo/rows': ({ req, query }) => {
    const asked = Number(query.get('count') ?? 50_000);
    const count = Number.isInteger(asked) ? Math.min(Math.max(asked, 1), MAX_DEMO_ROWS) : 50_000;
    return ndjson(req, async (emit, signal) => {
      for (let id = 1; id <= count && !signal.aborted; id++) {
        await emit({ id, name: `Item ${id}`, amount: Math.round(((id * 7919) % 100_000) / 10) / 10, date: new Date(Date.UTC(2024, 0, 1) + (id % 730) * 86_400_000).toISOString().slice(0, 10) });
        if (id % DEMO_BATCH === 0) await Bun.sleep(DEMO_PAUSE_MS);
      }
    });
  },
  'POST /api/demo/save-target': async ({ json }) => {
    const { format } = await json<{ format?: unknown }>().catch(() => ({ format: undefined }));
    const ext = format === 'json' ? 'json' : 'csv';
    const path = await saveFileAs({ suggestedName: `rows.${ext}`, filters: [{ name: ext.toUpperCase(), patterns: [`*.${ext}`] }] }).catch(fromPlatform);
    if (path) saveTargets.add(path);
    return { path };
  },
  'POST /api/demo/save': async ({ json }) => {
    const { path, text } = await json<{ path?: unknown; text?: unknown }>();
    if (typeof path !== 'string' || typeof text !== 'string' || !saveTargets.take(path)) throw forbidden('notASaveTarget', 'Choose where to save first.');
    await writeFileAtomic(path, text).catch(fromPlatform);
    return { ok: true };
  },
  // Example endpoint; delete it once real ones exist.
  'POST /api/echo': async ({ json }) => {
    const body = await json<{ text?: unknown }>();
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw invalid('emptyText', 'Type something first.');
    return { text, length: text.length, at: new Date().toISOString() };
  },
  // Example notification: a click opens the app on the Settings screen.
  'POST /api/toast/test': () => {
    toaster.show({ title: APP.name, body: 'Click to open the Settings.', launch: ctx.link('settings') });
    return { ok: true };
  },
});
