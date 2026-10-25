// Import boundaries: a view-* package never imports another view-* package, and no package imports from app/.
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
const SKIP_DIRS = new Set(['node_modules', 'dist']);
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
  const appName = packageName(join(root, 'app'));
  const appNames = new Set(appName ? [appName] : []);
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
          if (target === 'app' || target.startsWith('app/')) add('packages must not import from app/');
          else if (isView) {
            const m = /^packages\/(view-[^/]+)(?:\/|$)/.exec(target);
            if (m && m[1] !== pkg) add('view-* packages must not import another view-* package');
          }
          continue;
        }
        if (appNames.has(spec) || [...appNames].some((n) => spec.startsWith(`${n}/`))) {
          add('packages must not import from app/');
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
  return `${v.file}: ${v.rule.startsWith('native dialog') ? 'marker' : 'import'} '${v.specifier}' breaks rule: ${v.rule}`;
}

const NATIVE_RULE = 'native dialog: use the dialogs from @kedalion/ui (DialogHost)';
const NATIVE_SKIP_DIRS = new Set(['node_modules', 'dist', '.build']);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
// MessageBoxW stays in showError (fatal start-up error, no UI exists yet); osascript is only a dialog with `display dialog`.
const NATIVE_MARKERS: { re: RegExp; allow?: string[] }[] = [
  { re: /MessageBoxW/, allow: ['packages/platform/src/index.ts'] },
  { re: /FOS_PICKFOLDERS|IFileOpenDialog|IFileSaveDialog|GetOpenFileName/ },
  { re: /\b(?:zenity|kdialog)\b/ },
  { re: /osascript[^\n]*display dialog|\bchoose (?:file|folder)\b/ },
];
// Bare calls only count with a string or `t(...)` first argument: the UI's own `confirm({ ... })`/`prompt({ ... })` hooks take an object.
const WEB_MARKER = /\bwindow\.(?:confirm|alert|prompt)\(|(?<![\w$.])(?:confirm|alert|prompt)\(\s*(?:['"`]|t\()/;

function* walkAll(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!NATIVE_SKIP_DIRS.has(e.name)) yield* walkAll(join(dir, e.name));
    } else if (SOURCE.test(e.name) && !e.name.endsWith('.d.ts') && !TEST_FILE.test(e.name)) yield join(dir, e.name);
  }
}

function isWebFile(rel: string): boolean {
  if (rel.includes('/web/') || rel.startsWith('packages/ui/src/')) return true;
  return /^packages\/view-[^/]+\/src\//.test(rel) && !/(?:^|\/)server(?:[./]|$)/.test(rel.slice(rel.indexOf('/src/') + 5));
}

/** Native OS dialog markers in non-test sources of `app/` and `packages/`, and `alert`/`confirm`/`prompt` in web code. */
export function findNativeDialogs(root: string): Violation[] {
  const violations: Violation[] = [];
  for (const top of ['app', 'packages']) {
    const dir = join(root, top);
    if (!existsSync(dir)) continue;
    for (const file of walkAll(dir)) {
      const rel = relative(root, file).split(sep).join('/');
      const web = isWebFile(rel);
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const text = line.trimStart();
        if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return;
        const add = (marker: string) => violations.push({ file: `${rel}:${i + 1}`, specifier: marker, rule: NATIVE_RULE });
        for (const m of NATIVE_MARKERS) {
          const hit = m.re.exec(line);
          if (hit && !m.allow?.includes(rel)) add(hit[0]);
        }
        if (web) {
          const hit = WEB_MARKER.exec(line);
          if (hit) add(hit[0]);
        }
      });
    }
  }
  return violations;
}

if (import.meta.main) {
  const violations = [...findViolations(join(import.meta.dir, '..')), ...findNativeDialogs(join(import.meta.dir, '..'))];
  for (const v of violations) console.error(formatViolation(v));
  if (violations.length) {
    console.error(`${violations.length} import boundary violation(s)`);
    process.exit(1);
  }
  console.log('import boundaries ok');
}
