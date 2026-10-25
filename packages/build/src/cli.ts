#!/usr/bin/env bun
// `deckbuilder <command>`, run from an app folder (apps/<name>) through its package.json scripts.
import { parseArgs } from 'node:util';
import type { VersionBump } from '@deckbuilderkit/server-core';
import { buildExe, buildWeb, parseTargets } from './build.ts';
import { dev } from './dev.ts';
import { loadApp } from './app.ts';
import { keygen } from './keys.ts';
import { BUMPS, release, writeManifest } from './release.ts';

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
    case 'release': {
      const { values } = parseArgs({
        args,
        options: {
          to: { type: 'string' },
          bump: { type: 'string', default: 'patch' },
          target: { type: 'string' },
          'dry-run': { type: 'boolean', default: false },
          'no-checks': { type: 'boolean', default: false },
          unsigned: { type: 'boolean', default: false },
        },
      });
      if (!values.to || !BUMPS.includes(values.bump as VersionBump)) {
        console.error('Usage: deckbuilder release --to <folder> [--bump patch|minor|major] [--target <list>] [--dry-run] [--no-checks] [--unsigned]');
        process.exit(1);
      }
      await release(app, {
        to: values.to,
        bump: values.bump as VersionBump,
        targets: parseTargets(values.target),
        dryRun: values['dry-run'],
        checks: !values['no-checks'],
        unsigned: values.unsigned,
      });
      break;
    }
    case 'manifest': {
      const { values } = parseArgs({ args, options: { unsigned: { type: 'boolean', default: false } } });
      await writeManifest(app, values.unsigned);
      break;
    }
    case 'keygen': {
      const { values } = parseArgs({ args, options: { force: { type: 'boolean', default: false } } });
      const { privateKey, publicKey } = keygen({ appId: app.id, appDir: app.dir, force: values.force });
      console.log(`wrote ${privateKey} (private: back it up, never commit it)
wrote ${publicKey} (public: commit it; the exe embeds it)`);
      break;
    }
    default:
      console.log(`Usage: deckbuilder <command>

  dev [server flags]        server (--dev, watch mode) + Vite dev server; e.g. dev --window, dev --app
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
        [--unsigned]          skip latest.json.sig (signed builds then refuse the update)
  manifest [--unsigned]       write release/latest.json and its .sig for the exes of the current
                              version in release/ (what GitHub releases need next to the exes)
  keygen [--force]            create the update signing key: private ~/.deckbuilder-keys/<id>.pem,
                              public update-key.pub in the app folder (commit it); release and
                              manifest sign with it (or env DECKBUILDER_SIGNING_KEY)`);
      process.exit(command ? 1 : 0);
  }
}

// One error path for every command: the message, no stack.
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
