/**
 * Publishes every packages/* to npm at the root package.json version, in dependency order.
 * `workspace:*` deps become that version in the packed manifest only; package.json files are
 * restored afterwards. `--dry-run` prints the order and version and packs, without publishing.
 * Auth comes from .npmrc (`//registry.npmjs.org/:_authToken=${NPM_TOKEN}`).
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

const pkgs: Pkg[] = readdirSync(join(root, 'packages')).map((d) => {
  const dir = join(root, 'packages', d);
  const raw = readFileSync(join(dir, 'package.json'), 'utf8');
  return { name: JSON.parse(raw).name, dir, raw, json: JSON.parse(raw) };
});
for (const p of pkgs) {
  if (p.json.private) throw new Error(`${p.name} is private`);
  if (p.json.version !== version) throw new Error(`${p.name} is at ${p.json.version}, root is ${version}`);
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

const order = publishOrder(pkgs);
console.log(`${dryRun ? 'dry run: ' : ''}version ${version}, order:`);
order.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));

const out = mkdtempSync(join(tmpdir(), 'deckbuilder-pack-'));
mkdirSync(out, { recursive: true });
for (const p of order) {
  const file = join(p.dir, 'package.json');
  writeFileSync(file, JSON.stringify(pinned(p.json), null, 2) + '\n');
  try {
    run(['bun', 'pm', 'pack', '--destination', out], p.dir);
    if (!dryRun) {
      const tgz = join(out, `${p.name.replace('@', '').replace('/', '-')}-${version}.tgz`);
      run(['bun', 'publish', tgz, '--access', 'public'], p.dir);
    }
  } finally {
    writeFileSync(file, p.raw);
  }
}
console.log(dryRun ? `packed ${order.length} packages into ${out}` : `published ${order.length} packages at ${version}`);
