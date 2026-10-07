import { join } from 'node:path';
import { appHome } from '@deckbase/platform';
import { infoRoutes, settingsRoutes, settingsStore, type BaseSettings } from '@deckbase/server-mods';
import { runApp } from '@deckbase/shell';
import { APP } from '../app.ts';
import pkg from '../package.json';
import { routes } from './routes.ts';

export type Settings = BaseSettings;

const dataDir = appHome(APP.id);
const settings = settingsStore<Settings>({ dir: dataDir, defaults: { theme: 'dark' } });

runApp({
  app: APP,
  routes: {
    ...infoRoutes({ app: APP, version: pkg.version, dataDir }),
    ...settingsRoutes(settings),
    ...routes,
  },
  webDir: join(import.meta.dir, '../dist/web'),
});
