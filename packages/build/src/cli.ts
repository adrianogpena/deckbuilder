#!/usr/bin/env bun
// `deckbuilder <command>`, run from an app folder (apps/<name>) through its package.json scripts.
import { parseArgs } from 'node:util';
import type { VersionBump } from '@deckbuilder/server-core';
import { buildExe, buildWeb, parseTargets } from './build.ts';
import { dev } from './dev.ts';
import { loadApp } from './app.ts';
import { createApp } from './new.ts';
import { BUMPS, release, writeManifest } from './release.ts';

const [command, ...args] = process.argv.slice(2);
// Only `new` runs outside an app folder.
if (command === 'new') {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { name: { type: 'string' }, id: { type: 'string' } } });
  const [dir] = positionals;
  if (!dir) {
    console.error('Usage: deckbuilder new <dir> [--name <Name>] [--id <id>]');
    process.exit(1);
  }
  try {
    const target = await createApp({ dir, name: values.name, id: values.id }, process.cwd());
    console.log(`Created ${target}

Next:
  bun install
  cd apps/${dir}
  bun run dev`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  process.exit(0);
}

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
  case 'release': {
    const { values } = parseArgs({
      args,
      options: {
        to: { type: 'string' },
        bump: { type: 'string', default: 'patch' },
        target: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'no-checks': { type: 'boolean', default: false },
      },
    });
    if (!values.to || !BUMPS.includes(values.bump as VersionBump)) {
      console.error('Usage: deckbuilder release --to <folder> [--bump patch|minor|major] [--target <list>] [--dry-run] [--no-checks]');
      process.exit(1);
    }
    await release(app, {
      to: values.to,
      bump: values.bump as VersionBump,
      targets: parseTargets(values.target),
      dryRun: values['dry-run'],
      checks: !values['no-checks'],
    });
    break;
  }
  case 'manifest':
    await writeManifest(app);
    break;
  default:
    console.log(`Usage: deckbuilder <command>

  new <dir> [--name <Name>] [--id <id>]
                              create apps/<dir> from the template (run from the repo root:
                              bun run new <dir>); id = URL scheme, data folder ~/.<id>
  dev [server flags]          server (--dev, watch mode) + Vite dev server; e.g. dev --window, dev --app
  build:web                   bundle web/ into dist/web
  build [--target <list>]     build:web, then one exe per target into release/
                              targets: windows-x64, linux-x64, linux-arm64, darwin-x64,
                              darwin-arm64, or "all" (default: this machine)
        [--no-web]            reuse the existing dist/web
  release --to <folder>       bump the version, run typecheck + tests, build, copy the exes and
                              latest.json to <folder>/<app name>/ (the updater's release folder),
                              then commit and tag <app folder>-v<version> locally (never pushes)
        [--bump patch|minor|major] [--target <list>] [--no-checks]
        [--dry-run]           publish only; package.json and git stay as they are
  manifest                    write release/latest.json for the exes of the current version in
                              release/ (what GitHub releases need next to the exes)`);
    process.exit(command ? 1 : 0);
}
