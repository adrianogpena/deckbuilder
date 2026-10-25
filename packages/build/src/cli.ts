#!/usr/bin/env bun
// `kedalion <command>`, run from an app folder (app/) through its package.json scripts.
import { parseArgs } from 'node:util';
import { buildExe, buildWeb, parseTargets } from './build.ts';
import { dev } from './dev.ts';
import { loadApp } from './app.ts';

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  const app = await loadApp(process.cwd());

  switch (command) {
    case 'dev':
      await dev(app, args);
      break;
    case 'build:web':
      buildWeb(app);
      break;
    case 'build': {
      const { values } = parseArgs({ args, options: { target: { type: 'string' }, 'no-web': { type: 'boolean', default: false } } });
      const targets = parseTargets(values.target);
      if (!values['no-web']) buildWeb(app);
      for (const target of targets) await buildExe(app, target);
      break;
    }
    default:
      console.log(`Usage: kedalion <command>

  dev [server flags]        server (--dev, watch mode) + Vite dev server; e.g. dev --window, dev --app
  build:web                   bundle web/ into dist/web
  build [--target <list>]     build:web, then one exe per target into release/
                              targets: windows-x64, linux-x64, linux-arm64, darwin-x64,
                              darwin-arm64, or "all" (default: this machine)
        [--no-web]            reuse the existing dist/web`);
      process.exit(command ? 1 : 0);
  }
}

// One error path for every command: the message, no stack.
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
