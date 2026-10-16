// `deckbuilder add view <id>`: scaffolds packages/view-<id> from view-template and registers it in the gallery.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEMPLATE = join(import.meta.dir, '..', 'view-template');
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export interface ViewNames {
  id: string;
  /** PascalCase, e.g. `MyView`. */
  name: string;
  /** camelCase, e.g. `myView`. */
  camel: string;
  /** Title words, e.g. `My View`. */
  title: string;
}

export function validateViewId(id: string, root: string): string | null {
  if (!ID.test(id)) return `View id "${id}" must be lowercase kebab-case (letters, digits and single dashes, starting with a letter).`;
  if (existsSync(join(root, 'packages', `view-${id}`))) return `packages/view-${id} already exists.`;
  return null;
}

export function viewNames(id: string): ViewNames {
  const words = id.split('-');
  const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);
  const name = words.map(cap).join('');
  return { id, name, camel: name[0]!.toLowerCase() + name.slice(1), title: words.map(cap).join(' ') };
}

export function fillViewPlaceholders(text: string, n: ViewNames): string {
  return text.replaceAll('__VIEW_ID__', n.id).replaceAll('__VIEW_NAME__', n.name).replaceAll('__VIEW_CAMEL__', n.camel).replaceAll('__VIEW_TITLE__', n.title);
}

function copyFilled(from: string, to: string, n: ViewNames): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (entry === 'node_modules') continue;
    const src = join(from, entry);
    if (statSync(src).isDirectory()) copyFilled(src, join(to, entry), n);
    else writeFileSync(join(to, entry), fillViewPlaceholders(readFileSync(src, 'utf8'), n));
  }
}

function edit(file: string, change: (text: string) => string): void {
  const text = readFileSync(file, 'utf8');
  const crlf = text.includes('\r\n');
  const out = change(text.replaceAll('\r\n', '\n'));
  writeFileSync(file, crlf ? out.replaceAll('\n', '\r\n') : out);
}

/** Inserts `line` after the last line matching `pattern`. */
function insertAfterLast(text: string, pattern: RegExp, line: string, file: string): string {
  const lines = text.split('\n');
  const at = lines.map((l) => pattern.test(l)).lastIndexOf(true);
  if (at < 0) throw new Error(`Cannot register in ${file}: no line matches ${pattern}.`);
  lines.splice(at + 1, 0, line);
  return lines.join('\n');
}

export interface AddViewOptions {
  id: string;
  /** Workspace root. */
  root: string;
  /** Template folder; defaults to the one shipped with the build package. */
  template?: string;
}

/** Creates `packages/view-<id>` and registers it in the gallery; returns the package path. */
export function addView({ id, root, template = TEMPLATE }: AddViewOptions): string {
  const error = validateViewId(id, root);
  if (error) throw new Error(error);
  const n = viewNames(id);
  const web = join(root, 'apps', 'gallery', 'web', 'src', 'views.ts');
  const server = join(root, 'apps', 'gallery', 'server', 'views.ts');
  const pkgJson = join(root, 'apps', 'gallery', 'package.json');
  for (const f of [web, server, pkgJson]) if (!existsSync(f)) throw new Error(`${f} not found; run from the DeckBuilder repo.`);

  const target = join(root, 'packages', `view-${id}`);
  copyFilled(template, target, n);

  edit(web, (text) => {
    const orders = [...text.matchAll(/order: (\d+)/g)].map((m) => Number(m[1]));
    const order = Math.max(0, ...orders) + 10;
    const withImport = insertAfterLast(text, /^import .* from '@deckbuilder\/view-[\w-]+\/web';?$/, `import { ${n.camel}View } from '@deckbuilder/view-${id}/web';`, web);
    const marker = /\],(\r?\n\s*\{ fallback)/;
    if (!marker.test(withImport)) throw new Error(`Cannot register in ${web}: createViews list not found.`);
    return withImport.replace(marker, `, ${n.camel}View({ group: 'nav.section.main', order: ${order} })],$1`);
  });

  edit(server, (text) => {
    const withImport = insertAfterLast(text, /^import .* from '@deckbuilder\/view-[\w-]+\/server';?$/, `import { ${n.camel}ServerView } from '@deckbuilder/view-${id}/server';`, server);
    const marker = /(serverViews: ServerViewDef\[\] = \[[\s\S]*?\n)\];/;
    if (!marker.test(withImport)) throw new Error(`Cannot register in ${server}: serverViews list not found.`);
    return withImport.replace(marker, `$1  ${n.camel}ServerView(),\n];`);
  });

  edit(pkgJson, (text) => {
    const pkg = JSON.parse(text) as { dependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, [`@deckbuilder/view-${id}`]: 'workspace:*' };
    pkg.dependencies = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => (a < b ? -1 : 1)));
    return `${JSON.stringify(pkg, null, 2)}\n`;
  });
  return target;
}
