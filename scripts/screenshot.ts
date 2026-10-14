// `bun scripts/screenshot.ts --out <png>`: screenshot of the gallery UI in headless Edge/Chrome,
// driven over the DevTools protocol. Runs its own --dev server on port 7799 with a temp home, so
// the user's ~/.deckbuilder stays untouched. Flags: see USAGE.
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findAppBrowser } from '../packages/platform/src/browser.ts';
import { killTree, waitForUrl } from '../packages/platform/src/run.ts';

const USAGE = `Usage: bun scripts/screenshot.ts --out <png> [--hash <route>] [--settings '<json>'] [--seed '<json>']
       [--eval '<js>']
       [--size 1280x820] [--wait <ms>] [--no-build]

  --out <png>         where to write the screenshot
  --hash <route>      screen to load (#<route>), e.g. settings
  --settings <json>   contents of settings.json in the temp home (default {})
  --seed <json>       {"<file>.json": <value>} written next to settings.json (e.g. projects.json); not settings.json
                      {{GITREPO}} in --seed/--settings becomes the path of a small git repo in the temp home
                      (one commit, then an uncommitted edit and a new file)
  --eval <js>         run in the page after loading (awaited), 500 ms before the capture
  --size WxH          viewport size (default 1280x820)
  --wait <ms>         wait after the load event (default 1500)
  --no-build          reuse the last UI build instead of running build:web`;

const ROOT = join(import.meta.dir, '..');
const PORT = 7799;
const APP_URL = `http://127.0.0.1:${PORT}`;

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    hash: { type: 'string', default: '' },
    settings: { type: 'string', default: '{}' },
    seed: { type: 'string', default: '{}' },
    eval: { type: 'string' },
    size: { type: 'string', default: '1280x820' },
    wait: { type: 'string', default: '1500' },
    'no-build': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (args.help || !args.out) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 1);
}
const size = /^(\d+)x(\d+)$/.exec(args.size);
const wait = Number(args.wait);
if (!size || !(wait >= 0)) {
  console.error(USAGE);
  process.exit(1);
}
const [width, height] = [Number(size[1]), Number(size[2])];
const GIT_TOKEN = '{{GITREPO}}';
const usesRepo = args.seed.includes(GIT_TOKEN) || args.settings.includes(GIT_TOKEN);
const sub = (text: string, repo: string) => text.split(GIT_TOKEN).join(JSON.stringify(repo).slice(1, -1));
let settings = JSON.parse(usesRepo ? '{}' : args.settings) as unknown;
let seed = JSON.parse(usesRepo ? '{}' : args.seed) as Record<string, unknown>;
for (const name of Object.keys(seed)) {
  if (!/^[\w.-]+\.json$/.test(name) || name === 'settings.json') {
    console.error(`--seed: invalid file name ${name} (settings.json: use --settings)`);
    process.exit(1);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Kills a process and its children; `bun` and the browser both start child processes. */
function stop(proc: Bun.Subprocess | undefined): void {
  if (proc && proc.exitCode === null) killTree(proc.pid);
}

/** Reads the server's output until the startup line with the launch URL (`?c=<code>`). */
async function launchCode(stdout: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stdout) {
    text += decoder.decode(chunk, { stream: true });
    const m = /[?&]c=([0-9a-f]+)/.exec(text);
    if (m) return m[1]!;
  }
  throw new Error('The server printed no launch URL');
}

async function until<T>(what: string, ms: number, probe: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await probe();
    if (value !== undefined) return value;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Minimal DevTools protocol client: commands and one-shot event waits. */
async function devtools(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((ok, fail) => {
    ws.onopen = () => ok();
    ws.onerror = () => fail(new Error(`Cannot connect to ${wsUrl}`));
  });
  let nextId = 1;
  const pending = new Map<number, { ok: (r: any) => void; fail: (e: Error) => void }>();
  const waiters = new Map<string, () => void>();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.fail(new Error(`${msg.error.message} (${msg.error.code})`));
      else p?.ok(msg.result);
    } else {
      waiters.get(msg.method)?.();
      waiters.delete(msg.method);
    }
  };
  return {
    send(method: string, params: object = {}): Promise<any> {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((ok, fail) => pending.set(id, { ok, fail }));
    },
    once(method: string, timeoutMs: number): Promise<void> {
      return new Promise((ok, fail) => {
        const timer = setTimeout(() => fail(new Error(`Timed out waiting for ${method}`)), timeoutMs);
        waiters.set(method, () => (clearTimeout(timer), ok()));
      });
    },
    close: () => ws.close(),
  };
}

const temp = await mkdtemp(join(tmpdir(), 'deckbuilder-shot-'));
let server: Bun.Subprocess | undefined;
let browserProc: Bun.Subprocess | undefined;
let cdp: Awaited<ReturnType<typeof devtools>> | undefined;
let failed = false;
try {
  if (!args['no-build']) {
    const build = Bun.spawnSync(['bun', 'run', '--cwd', 'apps/gallery', 'build:web'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    if (build.exitCode !== 0) throw new Error('build:web failed');
  }

  const home = join(temp, 'home');
  await mkdir(join(home, '.deckbuilder'), { recursive: true });
  if (usesRepo) {
    const repo = join(home, 'demo-repo');
    await mkdir(repo, { recursive: true });
    const git = (...a: string[]) => {
      const r = Bun.spawnSync(['git', '-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', ...a], { cwd: repo, stdio: ['ignore', 'ignore', 'inherit'] });
      if (r.exitCode !== 0) throw new Error(`git ${a[0]} failed`);
    };
    await writeFile(join(repo, 'app.ts'), ["export function greet(name: string) {", "  return 'Hello, ' + name;", '}', '', 'export const version = 1;', ''].join('\n'));
    await writeFile(join(repo, 'README.md'), ['# Demo', '', 'A small demo repository.', ''].join('\n'));
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'Initial commit');
    await writeFile(join(repo, 'app.ts'), ["export function greet(name: string, punctuation = '!') {", '  return `Hello, ${name}${punctuation}`;', '}', '', 'export const version = 2;', ''].join('\n'));
    await writeFile(join(repo, 'notes.txt'), 'todo: add tests' + '\n');
    settings = JSON.parse(sub(args.settings, repo));
    seed = JSON.parse(sub(args.seed, repo)) as Record<string, unknown>;
  }
  await writeFile(join(home, '.deckbuilder', 'settings.json'), JSON.stringify(settings, null, 2));
  for (const [name, value] of Object.entries(seed)) {
    await writeFile(join(home, '.deckbuilder', name), JSON.stringify(value, null, 2));
  }
  const proc = Bun.spawn(['bun', 'apps/gallery/server/main.ts', '--dev', '--port', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, USERPROFILE: home, HOME: home },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server = proc;
  if (!(await waitForUrl(`${APP_URL}/`, { timeoutMs: 30_000, until: () => proc.exitCode !== null }))) {
    if (proc.exitCode !== null) throw new Error(`The server exited with code ${proc.exitCode} (port ${PORT} in use?)`);
    throw new Error('Timed out waiting for the server');
  }
  const code = await launchCode(proc.stdout);

  const browser = findAppBrowser();
  if (!browser) throw new Error('No Edge or Chrome found');
  const profile = join(temp, 'edge');
  browserProc = Bun.spawn(
    [browser, '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
      '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  const port = await until('DevToolsActivePort', 30_000, async () => {
    const file = join(profile, 'DevToolsActivePort');
    return existsSync(file) ? Number((await readFile(file, 'utf8')).split('\n')[0]) || undefined : undefined;
  });
  const wsUrl = await until('the page target', 10_000, async () => {
    const targets = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json(), () => [])) as { type: string; webSocketDebuggerUrl: string }[];
    return targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  });

  cdp = await devtools(wsUrl);
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const loaded = cdp.once('Page.loadEventFired', 30_000);
  // The dev launch code is reusable, so the printed one still works.
  await cdp.send('Page.navigate', { url: `${APP_URL}/?c=${code}#${args.hash}` });
  await loaded;
  await sleep(wait);
  if (args.eval) {
    const r = await cdp.send('Runtime.evaluate', { expression: args.eval, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`--eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    await sleep(500);
  }
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const out = resolve(args.out);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(shot.data, 'base64'));
  console.log(out);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  failed = true;
} finally {
  cdp?.close();
  stop(browserProc);
  stop(server);
  await Promise.all([browserProc?.exited, server?.exited]);
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
process.exit(failed ? 1 : 0);
