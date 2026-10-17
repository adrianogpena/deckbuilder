import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { isUrlScheme } from '@deckbuilderkit/server-core/protocol';

const TEMPLATE = join(import.meta.dir, '..', 'template');
const BINARY = new Set(['.png', '.ico', '.woff', '.woff2']);

export interface NewAppOptions {
  dir: string;
  name?: string;
  id?: string;
  /** View ids to compose, e.g. `['terminal']`. */
  views?: string[];
  /** Link the packages of this checkout instead of the published version. */
  local?: boolean;
  /** Run `git init` in the new folder. */
  git?: boolean;
}

export interface NewApp {
  dir: string;
  name: string;
  id: string;
}

/** `my-tool` → `My Tool`. */
const titleOf = (dir: string): string => dir.split('-').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

/** Applies the defaults and returns the problem with the input, if any. */
export function validateNewApp(opts: NewAppOptions): { app: NewApp } | { error: string } {
  const dir = opts.dir.split(/[\\/]+/).filter(Boolean).at(-1) ?? '';
  if (!/^[a-z][a-z0-9-]*$/.test(dir)) return { error: `Folder name "${dir}" must be lowercase letters, digits and dashes, starting with a letter.` };
  const id = opts.id ?? dir.replaceAll('-', '');
  if (!isUrlScheme(id)) return { error: `Id "${id}" must be lowercase letters, digits, "+", "." or "-", starting with a letter (it is the URL scheme).` };
  const name = opts.name?.trim() || titleOf(dir);
  if (/['"`/\\\x00-\x1f\x7f]|\.\./.test(name)) return { error: `Name "${name}" must not contain quotes, slashes, ".." or control characters.` };
  return { app: { dir, name, id } };
}

export function fillPlaceholders(text: string, app: NewApp): string {
  return text.replaceAll('__APP_NAME__', app.name).replaceAll('__APP_ID__', app.id).replaceAll('__APP_DIR__', app.dir);
}

function copyFilled(from: string, to: string, app: NewApp): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    const dest = join(to, entry);
    if (statSync(src).isDirectory()) copyFilled(src, dest, app);
    else if (BINARY.has(extname(entry).toLowerCase())) cpSync(src, dest);
    else writeFileSync(dest, fillPlaceholders(readFileSync(src, 'utf8'), app));
  }
}

/** A view package a standalone app can compose; the options are the code the generated lists call it with. */
interface ViewSpec {
  /** Package folder, `packages/<pkg>`. */
  pkg: string;
  web: string;
  webOptions: string;
  webSettings: string;
  server: string;
  serverOptions: string;
  serverSettings: string;
  /** Capability packages the generated server code imports (the stores). */
  deps?: string[];
  /** The stores the view reads from `ctx.stores`. */
  stores?: Array<'app' | 'db'>;
}

export const VIEW_SPECS: Record<string, ViewSpec> = {
  explorer: {
    pkg: 'view-explorer',
    web: 'explorerView',
    webOptions: '',
    webSettings: 'ExplorerViewSettings',
    server: 'explorerServerView',
    serverOptions: '',
    serverSettings: 'ExplorerServerSettings',
    deps: ['db'],
    stores: ['app', 'db'],
  },
  git: {
    pkg: 'view-git',
    web: 'gitView',
    webOptions: '',
    webSettings: 'GitViewSettings',
    server: 'gitServerView',
    serverOptions: '',
    serverSettings: 'GitServerSettings',
    stores: ['app'],
  },
  rest: {
    pkg: 'view-rest',
    web: 'restView',
    webOptions: '',
    webSettings: 'RestViewSettings',
    server: 'restServerView',
    serverOptions: '',
    serverSettings: 'RestServerSettings',
    stores: ['app'],
  },
  terminal: {
    pkg: 'view-terminal',
    web: 'terminalView',
    webOptions: '',
    webSettings: 'TerminalViewSettings',
    server: 'terminalServerView',
    serverOptions: "{ integrationDir: join(appHome(APP.id), 'shell-integration'), resolveCwd: async (root, path) => join(root, path) }",
    serverSettings: 'TerminalServerSettings',
  },
  agents: {
    pkg: 'view-agents',
    web: 'agentsView',
    webOptions: '',
    webSettings: 'AgentsViewSettings',
    server: 'agentsServerView',
    serverOptions: '',
    serverSettings: 'AgentsServerSettings',
    stores: ['app'],
  },
  workbench: {
    pkg: 'view-workbench',
    web: 'workbenchView',
    webOptions: '',
    webSettings: 'WorkbenchViewSettings',
    server: 'workbenchServerView',
    serverOptions: '',
    serverSettings: 'WorkbenchServerSettings',
    deps: ['db'],
    stores: ['app', 'db'],
  },
};

export function viewSpecs(ids: string[]): ViewSpec[] {
  return ids.map((id) => {
    const spec = VIEW_SPECS[id];
    if (!spec) throw new Error(`Unknown view "${id}"; known: ${Object.keys(VIEW_SPECS).join(', ')}.`);
    return spec;
  });
}

const pkgName = (spec: ViewSpec, scope: string) => `${scope}/${spec.pkg}`;

/** `web/src/view-settings.ts`: the settings the chosen views add to the web `Settings`. */
export function viewSettingsSource(ids: string[], scope: string): string {
  const specs = viewSpecs(ids);
  const imports = specs.map((v) => `import type { ${v.webSettings} } from '${pkgName(v, scope)}/web';`);
  const extend = specs.length ? ` extends ${specs.map((v) => v.webSettings).join(', ')}` : '';
  return `${imports.join('\n')}${imports.length ? '\n\n' : ''}/** The settings the chosen views add; \`Settings\` extends it. */\nexport interface ViewSettings${extend} {}\n`;
}

/** `web/src/views.ts`: `createViews` over Home and the chosen views. */
export function webViewsSource(ids: string[], scope: string): string {
  const specs = viewSpecs(ids);
  const imports = specs.map((v) => `import { ${v.web} } from '${pkgName(v, scope)}/web';`);
  const calls = specs.map((v, i) => `${v.web}({ group: 'nav.section.main', order: ${20 + i * 10}${v.webOptions ? ', ' + v.webOptions : ''} })`);
  return `import { createElement } from 'react';
import { addMessages, createViews, PanelLoading, type ViewIds } from '@deckbuilderkit/ui';
${imports.join('\n')}${imports.length ? '\n' : ''}import { homeView } from './screens/home.view';
import { settingsRegistry } from './settings';

/** The one list the nav, routes, screens, commands, settings and messages come from. */
export const views = createViews([homeView${calls.map((c) => ', ' + c).join('')}], { fallback: createElement(PanelLoading) });

export type ScreenId = ViewIds<typeof views>;

views.registerSettings(settingsRegistry);
addMessages(views.messages);
`;
}

/** `server/views.ts`: the server half of the list, the stores the views read from `ctx.stores` and the settings the views add. */
export function serverViewsSource(ids: string[], scope: string): string {
  const specs = viewSpecs(ids);
  const kinds = new Set(specs.flatMap((v) => v.stores ?? []));
  const hasExplorer = ids.includes('explorer');
  const imports = specs.map((v) => `import { ${v.server}, type ${v.serverSettings} } from '${pkgName(v, scope)}/server';`);
  const extend = specs.length ? ` extends ${specs.map((v) => v.serverSettings).join(', ')}` : '';
  const list = ids.map((id, i) => (id === 'explorer' ? '\n  explorer,' : `\n  ${specs[i]!.server}(${id === 'terminal' && hasExplorer ? specs[i]!.serverOptions.replace('async (root, path) => join(root, path)', 'explorer.resolveCwd') : specs[i]!.serverOptions}),`))
    .join('');
  const explorer = hasExplorer ? `const explorer = ${VIEW_SPECS.explorer!.server}();\n\n` : '';
  const platform = [...(ids.includes('terminal') ? ['appHome'] : []), ...(kinds.size ? ['secretStore'] : [])];
  const storeImports = [
    ...(kinds.has('db') ? [`import { dbStores } from '${scope}/db';`] : []),
    ...(kinds.has('app') ? [`import { appStores } from '${scope}/server-mods';`] : []),
  ];
  const parts = [...(kinds.has('app') ? ['...appStores(APP.id, { secrets })'] : []), ...(kinds.has('db') ? ['...dbStores(APP.id, { secrets })'] : [])];
  const storesCode = kinds.size
    ? `const secrets = secretStore(APP.id);\n\n/** The stores the views read from \`ctx.stores\`. */\nexport const stores = { ${parts.join(', ')} };\n`
    : '/** The stores the views read from `ctx.stores`; the chosen views need none. */\nexport const stores = {};\n';
  const nodeImport = ids.includes('terminal') ? "import { join } from 'node:path';\n" : '';
  const platformImport = platform.length ? `import { ${platform.join(', ')} } from '@deckbuilderkit/platform';\n` : '';
  return `${nodeImport}${platformImport}${storeImports.map((i) => i + '\n').join('')}import type { ServerViewDef } from '@deckbuilderkit/server-core';
${imports.join('\n')}${imports.length ? '\n' : ''}import { APP } from '../app.ts';

/** The settings the chosen views add; \`Settings\` extends it. */
export interface ViewSettings${extend} {}

${storesCode}
${explorer}export const serverViews: ServerViewDef[] = [${list}${list ? '\n' : ''}];
`;
}

interface BuildPackage {
  /** Package name scope, e.g. `@deckbuilderkit`. */
  scope: string;
  version: string;
  /** The checkout's packages folder; null for an installed copy. */
  packagesDir: string | null;
}

/** Scope and version come from this package's own manifest: every package is published at one version. */
export function buildPackage(): BuildPackage {
  const own = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8')) as { name: string; version: string };
  const siblings = join(import.meta.dir, '..', '..');
  return { scope: own.name.split('/')[0]!, version: own.version, packagesDir: existsSync(join(siblings, 'server-core', 'package.json')) ? siblings : null };
}

/** The app's `package.json`: the template's, with every `workspace:*` dep and the chosen view packages at the current version, or `link:`ed to the checkout with `local`. */
export function appPackageJson(app: NewApp, opts: { views: string[]; local: boolean }, pkg: BuildPackage = buildPackage()): Record<string, any> {
  const json = JSON.parse(fillPlaceholders(readFileSync(join(TEMPLATE, 'package.json'), 'utf8'), app));
  const range = (name: string): string => {
    if (!opts.local) return pkg.version;
    if (!pkg.packagesDir) throw new Error('--local needs a checkout of the deckbuilder monorepo.');
    return `link:${name}`;
  };
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, r] of Object.entries<string>(json[field])) if (r.startsWith('workspace:')) json[field][name] = range(name);
  }
  for (const v of viewSpecs(opts.views)) {
    for (const name of [pkgName(v, pkg.scope), ...(v.deps ?? []).map((d) => `${pkg.scope}/${d}`)]) json.dependencies[name] = range(name);
  }
  json.dependencies = Object.fromEntries(Object.entries(json.dependencies).sort(([a], [b]) => a.localeCompare(b)));
  return json;
}

/** `bun link` in each checkout package the app depends on as `link:<name>`, so `bun install` finds it. */
function registerLinks(json: Record<string, any>, packagesDir: string): void {
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries<string>(json[field])) {
      if (!range.startsWith('link:')) continue;
      const run = Bun.spawnSync(['bun', 'link'], { cwd: join(packagesDir, name.split('/')[1]!), stdout: 'ignore', stderr: 'pipe' });
      if (run.exitCode !== 0) throw new Error(`bun link failed for ${name}: ${run.stderr.toString().trim()}`);
    }
  }
}

/** Creates `<dir>` (relative to `cwd`; its last segment names the app) from the template, on the published packages (or linked to this checkout with `local`); returns its path. */
export async function createApp(opts: NewAppOptions, cwd: string): Promise<string> {
  const checked = validateNewApp(opts);
  if ('error' in checked) throw new Error(checked.error);
  const views = opts.views ?? [];
  const pkg = buildPackage();
  const packageJson = appPackageJson(checked.app, { views, local: opts.local ?? false }, pkg);
  const target = resolve(cwd, opts.dir);
  if (existsSync(target)) throw new Error(`${target} already exists.`);
  copyFilled(TEMPLATE, target, checked.app);
  writeFileSync(join(target, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
  if (opts.local && pkg.packagesDir) registerLinks(packageJson, pkg.packagesDir);
  writeFileSync(join(target, 'web', 'src', 'view-settings.ts'), viewSettingsSource(views, pkg.scope));
  writeFileSync(join(target, 'web', 'src', 'views.ts'), webViewsSource(views, pkg.scope));
  writeFileSync(join(target, 'server', 'views.ts'), serverViewsSource(views, pkg.scope));
  writeFileSync(join(target, '.gitignore'), 'node_modules\ndist\nrelease\n');
  if (opts.git) Bun.spawnSync(['git', 'init'], { cwd: target });
  return target;
}
