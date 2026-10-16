import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY_URL = 'https://registry.npmjs.org/@deckbuilderkit/build';
const SCOPE = '@deckbuilderkit/';

export interface UpgradeOptions {
  /** Latest published version; default reads `dist-tags.latest` of @deckbuilderkit/build from the npm registry. */
  fetchLatest?: () => Promise<string>;
  /** Runs `bun install` in the app dir; default spawns bun. */
  install?: (dir: string) => Promise<void> | void;
}

export interface UpgradeResult {
  version: string;
  updated: string[];
  /** `link:`/`workspace:` deps, left as they are. */
  skipped: string[];
}

export async function fetchLatestVersion(fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(REGISTRY_URL);
  if (!res.ok) throw new Error(`npm registry answered ${res.status} for @deckbuilderkit/build.`);
  const body = (await res.json()) as { 'dist-tags'?: { latest?: string } };
  const latest = body['dist-tags']?.latest;
  if (!latest) throw new Error('npm registry response has no dist-tags.latest.');
  return latest;
}

function bunInstall(dir: string): void {
  const run = Bun.spawnSync(['bun', 'install'], { cwd: dir, stdout: 'inherit', stderr: 'inherit' });
  if (run.exitCode !== 0) throw new Error('bun install failed.');
}

/** Bumps every `@deckbuilderkit/*` dep of the app in `dir` to the latest published version, then installs. */
export async function upgradeApp(dir: string, opts: UpgradeOptions = {}): Promise<UpgradeResult> {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) throw new Error(`No package.json in ${dir}.`);
  const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
  const version = await (opts.fetchLatest ?? (() => fetchLatestVersion()))();
  const updated: string[] = [];
  const skipped: string[] = [];
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = json[field] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (!name.startsWith(SCOPE)) continue;
      if (range.startsWith('link:') || range.startsWith('workspace:')) skipped.push(name);
      else {
        deps[name] = version;
        updated.push(name);
      }
    }
  }
  if (updated.length === 0 && skipped.length === 0) throw new Error('This app has no @deckbuilderkit/* dependencies.');
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  if (updated.length > 0) await (opts.install ?? bunInstall)(dir);
  return { version, updated, skipped };
}
