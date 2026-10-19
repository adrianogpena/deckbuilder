/**
 * Publishes every packages/* to npm at the root package.json version, in dependency order.
 * `workspace:*` deps become that version in the packed manifest only; package.json files are
 * restored afterwards. `--dry-run` prints the order and version and packs, without publishing.
 * Runs `npm publish`, which authenticates through npm trusted publishing (GitHub OIDC) in CI.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const dryRun = process.argv.includes('--dry-run');
const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];

interface Pkg {
  name: string;
  dir: string;
  raw: string;
  json: Record<string, any>;
}

const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`root package.json version is not semver: ${version}`);

const all: Pkg[] = readdirSync(join(root, 'packages')).map((d) => {
  const dir = join(root, 'packages', d);
  const raw = readFileSync(join(dir, 'package.json'), 'utf8');
  return { name: JSON.parse(raw).name, dir, raw, json: JSON.parse(raw) };
});
// Private packages are not published, so no published package may depend on one.
const privateNames = new Set(all.filter((p) => p.json.private).map((p) => p.name));
const pkgs = all.filter((p) => !p.json.private);
for (const p of pkgs) {
  if (p.json.version !== version) throw new Error(`${p.name} is at ${p.json.version}, root is ${version}`);
  for (const f of DEP_FIELDS) for (const dep of Object.keys(p.json[f] ?? {})) {
    if (privateNames.has(dep)) throw new Error(`${p.name} depends on private ${dep}`);
  }
}

export function publishOrder(all: Pkg[]): Pkg[] {
  const byName = new Map(all.map((p) => [p.name, p]));
  const done = new Set<string>();
  const order: Pkg[] = [];
  const visit = (p: Pkg, stack: string[]) => {
    if (done.has(p.name)) return;
    if (stack.includes(p.name)) throw new Error(`dependency cycle: ${[...stack, p.name].join(' > ')}`);
    for (const f of DEP_FIELDS) for (const dep of Object.keys(p.json[f] ?? {})) {
      const d = byName.get(dep);
      if (d) visit(d, [...stack, p.name]);
    }
    done.add(p.name);
    order.push(p);
  };
  all.forEach((p) => visit(p, []));
  return order;
}

function pinned(json: Record<string, any>): Record<string, any> {
  const out = structuredClone(json);
  for (const f of DEP_FIELDS) for (const [dep, range] of Object.entries<string>(out[f] ?? {})) {
    if (range.startsWith('workspace:')) out[f][dep] = version;
  }
  return out;
}

function run(cmd: string[], cwd: string): void {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(' ')} failed in ${cwd}`);
}

/** True when name@version is already on npm, so a failed release can be re-run. */
async function published(name: string): Promise<boolean> {
  const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}/${version}`);
  return res.ok;
}

const order = publishOrder(pkgs);
console.log(`${dryRun ? 'dry run: ' : ''}version ${version}, order:`);
order.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));

const out = mkdtempSync(join(tmpdir(), 'deckbuilder-pack-'));
mkdirSync(out, { recursive: true });
for (const p of order) {
  if (!dryRun && (await published(p.name))) {
    console.log(`${p.name}@${version} is already published, skipped`);
    continue;
  }
  const file = join(p.dir, 'package.json');
  writeFileSync(file, JSON.stringify(pinned(p.json), null, 2) + '\n');
  try {
    run(['bun', 'pm', 'pack', '--destination', out], p.dir);
    if (!dryRun) {
      const tgz = join(out, `${p.name.replace('@', '').replace('/', '-')}-${version}.tgz`);
      run(['npm', 'publish', tgz, '--access', 'public'], p.dir);
    }
  } finally {
    writeFileSync(file, p.raw);
  }
}
console.log(dryRun ? `packed ${order.length} packages into ${out}` : `published ${order.length} packages at ${version}`);
