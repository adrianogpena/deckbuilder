// Import boundaries: a view-* package never imports another view-* package, and no package imports from apps/*.
// `bun scripts/check-boundaries.ts` exits 1 on violations; `findViolations(root)` is the testable core.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export interface Violation {
  file: string;
  specifier: string;
  rule: string;
}

// Known existing exceptions (test reading app command/view registries); remove once moved.
const ALLOWED = new Set(['packages/ui/tests/keybindings.test.ts']);
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'template', 'view-template']);
const IMPORT_RE =
  /(?:\b(?:import|export)\s[^'"`;]*?\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"\n]+)['"]/g;

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(join(dir, e.name));
    } else if (SOURCE.test(e.name) && !e.name.endsWith('.d.ts')) yield join(dir, e.name);
  }
}

function packageName(dir: string): string | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name;
  } catch {
    return undefined;
  }
}

export function specifiersOf(source: string): string[] {
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1]!);
}

export function findViolations(root: string): Violation[] {
  const packagesDir = join(root, 'packages');
  const appsDir = join(root, 'apps');
  const appNames = new Set(
    listDirs(appsDir).flatMap((d) => {
      const name = packageName(join(appsDir, d));
      return name ? [name] : [];
    }),
  );
  const violations: Violation[] = [];
  for (const pkg of listDirs(packagesDir)) {
    if (SKIP_DIRS.has(pkg)) continue;
    const pkgDir = join(packagesDir, pkg);
    const isView = pkg.startsWith('view-');
    const ownName = packageName(pkgDir);
    for (const file of walk(pkgDir)) {
      const rel = relative(root, file).split(sep).join('/');
      if (ALLOWED.has(rel)) continue;
      for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
        const add = (rule: string) => violations.push({ file: rel, specifier: spec, rule });
        if (spec.startsWith('.')) {
          const target = relative(root, resolve(file, '..', spec)).split(sep).join('/');
          if (target === 'apps' || target.startsWith('apps/')) add('packages must not import from apps/*');
          else if (isView) {
            const m = /^packages\/(view-[^/]+)(?:\/|$)/.exec(target);
            if (m && m[1] !== pkg) add('view-* packages must not import another view-* package');
          }
          continue;
        }
        if (appNames.has(spec) || [...appNames].some((n) => spec.startsWith(`${n}/`))) {
          add('packages must not import from apps/*');
        } else if (isView) {
          const m = /^@[^/]+\/(view-[^/]+)(?:\/|$)/.exec(spec);
          if (m && spec.split('/').slice(0, 2).join('/') !== ownName) {
            add('view-* packages must not import another view-* package');
          }
        }
      }
    }
  }
  return violations;
}

export function formatViolation(v: Violation): string {
  return `${v.file}: import '${v.specifier}' breaks rule: ${v.rule}`;
}

if (import.meta.main) {
  const violations = findViolations(join(import.meta.dir, '..'));
  for (const v of violations) console.error(formatViolation(v));
  if (violations.length) {
    console.error(`${violations.length} import boundary violation(s)`);
    process.exit(1);
  }
  console.log('import boundaries ok');
}
