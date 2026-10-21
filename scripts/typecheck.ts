// `bun run typecheck`: runs tsc on the root tsconfig.json (scripts/) and every one under packages/ and apps/, then the import and raw-button checks
// (except the app template, whose placeholders only become valid names through `deckbuilder new`).
import { Glob } from 'bun';
import { dirname, join } from 'node:path';
import { findViolations, formatViolation } from './check-boundaries';
import { findRawButtons, formatRawButton } from './check-buttons';

const ROOT = join(import.meta.dir, '..');
const configs = [
  'tsconfig.json',
  ...[...new Glob('{packages,apps}/**/tsconfig.json').scanSync({ cwd: ROOT })]
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => !path.includes('node_modules') && !path.includes('/template/') && !path.includes('/view-template/'))
    .sort(),
];

let failed = 0;
for (const config of configs) {
  console.log(`> tsc -p ${dirname(config)}`);
  const r = Bun.spawnSync(['bun', 'x', 'tsc', '-p', config], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.exitCode !== 0) failed++;
}
console.log('> import boundaries');
const violations = findViolations(ROOT);
for (const v of violations) console.error(formatViolation(v));
if (violations.length) failed++;
console.log('> raw buttons');
const rawButtons = findRawButtons(ROOT);
for (const v of rawButtons) console.error(formatRawButton(v));
if (rawButtons.length) failed++;
if (failed) {
  console.error(`${failed} of ${configs.length} projects failed`);
  process.exit(1);
}
