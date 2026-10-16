// Generates an app with one view (`new --views <id> --local`), installs and typechecks it, per view.
// Usage: bun scripts/check-single-views.ts [id]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VIEW_SPECS } from '../packages/build/src/new.ts';

const CLI = join(import.meta.dir, '..', 'packages', 'build', 'src', 'cli.ts');

function run(cmd: string[], cwd: string): string | null {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  return r.exitCode === 0 ? null : `${cmd.join(' ')}\n${r.stdout.toString()}${r.stderr.toString()}`;
}

function check(id: string): string | null {
  const root = mkdtempSync(join(tmpdir(), 'deckbuilder-single-'));
  try {
    const dir = `tmp-${id}`;
    const app = join(root, dir);
    return (
      run(['bun', CLI, 'new', dir, '--views', id, '--local'], root) ??
      run(['bun', 'install'], app) ??
      run(['bunx', 'tsc', '--noEmit', '-p', '.'], app)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const only = process.argv[2];
const ids = only ? [only] : Object.keys(VIEW_SPECS);
if (only && !VIEW_SPECS[only]) {
  console.error(`Unknown view "${only}". Views: ${Object.keys(VIEW_SPECS).join(', ')}`);
  process.exit(1);
}
let failed = 0;
for (const id of ids) {
  const error = check(id);
  console.log(`${error ? 'FAIL' : 'PASS'} ${id}`);
  if (error) {
    failed++;
    console.log(error);
  }
}
process.exit(failed ? 1 : 0);
