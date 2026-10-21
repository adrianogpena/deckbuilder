import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * An app folder, by convention:
 *   app.ts           exports APP ({ name, id })
 *   server/main.ts   server entry (calls runApp)
 *   web/             Vite root; web/public/favicon.svg is also the exe icon
 *   package.json     version
 */
export interface AppDir {
  dir: string;
  name: string;
  id: string;
  version: string;
  /** package.json `author`; the Windows exe's company name and copyright. */
  publisher?: string;
}

export async function loadApp(dir: string): Promise<AppDir> {
  for (const file of ['app.ts', 'server/main.ts', 'package.json']) {
    if (!existsSync(join(dir, file))) throw new Error(`${dir} is not an app folder: ${file} is missing`);
  }
  const { APP } = (await import(join(dir, 'app.ts'))) as { APP: { name: string; id: string } };
  const { version, author } = (await Bun.file(join(dir, 'package.json')).json()) as { version: string; author?: string | { name?: string } };
  const publisher = typeof author === 'string' ? author : author?.name;
  return { dir, name: APP.name, id: APP.id, version, ...(publisher ? { publisher } : {}) };
}

/** The folder whose package.json declares `workspaces` (the repo root), or `dir` itself. */
export async function workspaceRoot(dir: string): Promise<string> {
  for (let d = dir; ; d = dirname(d)) {
    const pkg = join(d, 'package.json');
    if (existsSync(pkg) && 'workspaces' in ((await Bun.file(pkg).json()) as object)) return d;
    if (dirname(d) === d) return dir;
  }
}

/** Runs a command in the app folder with inherited output; throws when it fails. */
export function run(app: AppDir, cmd: string[]): void {
  console.log(`> ${cmd.join(' ')}`);
  const r = Bun.spawnSync(cmd, { cwd: app.dir, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.exitCode !== 0) throw new Error(`failed: ${cmd.join(' ')}`);
}
