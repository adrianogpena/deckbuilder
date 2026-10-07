// `bun run typecheck`: runs tsc on the root tsconfig.json (scripts/) and every one under packages/ and apps/
// (except the app template, whose placeholders only become valid names through `deckbuilder new`).
import { Glob } from 'bun';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const configs = [
  'tsconfig.json',
  ...[...new Glob('{packages,apps}/**/tsconfig.json').scanSync({ cwd: ROOT })]
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => !path.includes('node_modules') && !path.includes('/template/'))
    .sort(),
];

let failed = 0;
for (const config of configs) {
  console.log(`> tsc -p ${dirname(config)}`);
  const r = Bun.spawnSync(['bun', 'x', 'tsc', '-p', config], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.exitCode !== 0) failed++;
}
if (failed) {
  console.error(`${failed} of ${configs.length} projects failed`);
  process.exit(1);
}
