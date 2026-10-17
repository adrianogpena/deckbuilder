import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Text import: `bun build --compile` inlines it, so the exe carries the script and writes it out at runtime.
import script from './script.mjs.txt' with { type: 'text' };

export const STATUSLINE_SCRIPT = script;
export const STATUSLINE_SCRIPT_FILE = 'statusline.mjs';

/** Name of the launcher the account's `statusLine.command` points at. */
export const statuslineWrapperFile = (platform: NodeJS.Platform = process.platform) => (platform === 'win32' ? 'statusline.cmd' : 'statusline.sh');

/**
 * Launcher that runs the script with the server's own runtime. `BUN_BE_BUN=1` makes a compiled DeckBuilder exe act as plain
 * `bun`, so no separate bun install is needed after packaging (a no-op for a real bun).
 */
export function statuslineWrapper(execPath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return ['@echo off', 'set BUN_BE_BUN=1', `"${execPath}" "%~dp0${STATUSLINE_SCRIPT_FILE}" %*`, ''].join('\r\n');
  return ['#!/bin/sh', `BUN_BE_BUN=1 exec "${execPath}" "$(dirname "$0")/${STATUSLINE_SCRIPT_FILE}" "$@"`, ''].join('\n');
}

/** Writes the script and its launcher into `agentsDir` (overwrites: keeps `execPath` current); returns the launcher path. */
export function writeStatuslineFiles(agentsDir: string, execPath: string, platform: NodeJS.Platform = process.platform): string {
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, STATUSLINE_SCRIPT_FILE), STATUSLINE_SCRIPT);
  const wrapper = join(agentsDir, statuslineWrapperFile(platform));
  writeFileSync(wrapper, statuslineWrapper(execPath, platform));
  if (platform !== 'win32') chmodSync(wrapper, 0o755);
  return wrapper;
}
