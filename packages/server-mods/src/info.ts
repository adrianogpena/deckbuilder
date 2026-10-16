import { hostname } from 'node:os';
import type { AppIdentity, Routes } from '@deckbuilderkit/server-core';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  hostname: string;
  bun: string;
  dataDir: string;
  startedAt: string;
}

/** GET /api/info: app version and runtime facts, for an About or Home screen. */
export function infoRoutes(opts: { app: AppIdentity; version: string; dataDir: string }): Routes {
  const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  return {
    'GET /api/info': (): AppInfo => ({
      name: opts.app.name,
      version: opts.version,
      platform: process.platform,
      arch: process.arch,
      hostname: hostname(),
      bun: Bun.version,
      dataDir: opts.dataDir,
      startedAt,
    }),
  };
}
