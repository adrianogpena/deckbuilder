#!/usr/bin/env bun
// `deckbase <command>`, run from an app folder (apps/<name>) through its package.json scripts.
import { buildExe, buildWeb, parseTargets } from './build.ts';
import { dev } from './dev.ts';
import { loadApp } from './app.ts';

const [command, ...args] = process.argv.slice(2);
const app = await loadApp(process.cwd());

switch (command) {
  case 'dev':
    await dev(app, args);
    break;
  case 'build:web':
    buildWeb(app);
    break;
  case 'build': {
    const i = args.indexOf('--target');
    const targets = parseTargets(i >= 0 ? args[i + 1] : undefined);
    if (!args.includes('--no-web')) buildWeb(app);
    for (const target of targets) await buildExe(app, target);
    break;
  }
  default:
    console.log(`Usage: deckbase <command>

  dev [server flags]          server (--dev, watch mode) + Vite dev server; e.g. dev --window
  build:web                   bundle web/ into dist/web
  build [--target <list>]     build:web, then one exe per target into release/
                              targets: windows-x64, linux-x64, linux-arm64, darwin-x64,
                              darwin-arm64, or "all" (default: this machine)
        [--no-web]            reuse the existing dist/web`);
    process.exit(command ? 1 : 0);
}
