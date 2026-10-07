import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { APP } from '../shared/app.js';
import { invalid } from './errors.js';
import { loadSettings, saveSettings, settingsDir } from './settings.js';

export type Query = URLSearchParams;
export type Handler = (q: Query, req: IncomingMessage, res: ServerResponse) => Promise<unknown>;

const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The API. Keys are "METHOD /path"; handlers return a JSON-serializable value
 * or throw an AppError (see errors.ts). Add your project's endpoints here.
 */
export const routes: Record<string, Handler> = {
  'GET /api/info': async () => ({
    name: APP.name,
    version: pkg.version,
    platform: process.platform,
    arch: process.arch,
    hostname: hostname(),
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    settingsDir: settingsDir(),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  }),

  'GET /api/settings': async () => loadSettings(),
  'PUT /api/settings': async (_q, req) => saveSettings(await readJson(req)),

  // Example endpoint; delete it once real ones exist.
  'POST /api/echo': async (_q, req) => {
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw invalid('emptyText', 'Type something first.');
    return { text, length: text.length, at: new Date().toISOString() };
  },
};

export async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw invalid('bodyTooLarge', 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw invalid('invalidJson', 'Invalid JSON.');
  }
}
