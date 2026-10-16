import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { isUrlScheme } from '@deckbuilderkit/server-core/protocol';
import { workspaceRoot } from './app.ts';

const TEMPLATE = join(import.meta.dir, '..', 'template');
const BINARY = new Set(['.png', '.ico', '.woff', '.woff2']);

export interface NewAppOptions {
  dir: string;
  name?: string;
  id?: string;
}

export interface NewApp {
  dir: string;
  name: string;
  id: string;
}

/** `my-tool` → `My Tool`. */
const titleOf = (dir: string): string => dir.split('-').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

/** Applies the defaults and returns the problem with the input, if any. */
export function validateNewApp(opts: NewAppOptions): { app: NewApp } | { error: string } {
  if (!/^[a-z][a-z0-9-]*$/.test(opts.dir)) return { error: `Folder name "${opts.dir}" must be lowercase letters, digits and dashes, starting with a letter.` };
  const id = opts.id ?? opts.dir.replaceAll('-', '');
  if (!isUrlScheme(id)) return { error: `Id "${id}" must be lowercase letters, digits, "+", "." or "-", starting with a letter (it is the URL scheme).` };
  const name = opts.name?.trim() || titleOf(opts.dir);
  if (/['"`/\\\x00-\x1f\x7f]|\.\./.test(name)) return { error: `Name "${name}" must not contain quotes, slashes, ".." or control characters.` };
  return { app: { dir: opts.dir, name, id } };
}

export function fillPlaceholders(text: string, app: NewApp): string {
  return text.replaceAll('__APP_NAME__', app.name).replaceAll('__APP_ID__', app.id).replaceAll('__APP_DIR__', app.dir);
}

function copyFilled(from: string, to: string, app: NewApp): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dest = join(to, entry);
    if (statSync(src).isDirectory()) copyFilled(src, dest, app);
    else if (BINARY.has(extname(entry).toLowerCase())) cpSync(src, dest);
    else writeFileSync(dest, fillPlaceholders(readFileSync(src, 'utf8'), app));
  }
}

/** Creates `apps/<dir>` in the workspace root from the template; returns its path. */
export async function createApp(opts: NewAppOptions, cwd: string): Promise<string> {
  const checked = validateNewApp(opts);
  if ('error' in checked) throw new Error(checked.error);
  const root = await workspaceRoot(cwd);
  const target = join(root, 'apps', checked.app.dir);
  if (existsSync(target)) throw new Error(`${target} already exists.`);
  copyFilled(TEMPLATE, target, checked.app);
  return target;
}
