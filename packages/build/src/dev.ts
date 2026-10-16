import { killTreeSync, waitForUrl } from '@deckbuilderkit/platform';
import { DEV_PORT, VITE_PORT } from '@deckbuilderkit/server-core/protocol';
import { join, relative } from 'node:path';
import { type AppDir, workspaceRoot } from './app.ts';

const WAIT_MS = 30_000;

/**
 * Runs the server in watch mode (`--dev`: port 7420; it prints the URL to open) and the Vite dev
 * server, which proxies /api to it. Vite starts once the server answers, so the first page load
 * doesn't hit a closed port. Ctrl+C stops both process trees (on Windows a plain kill
 * leaves the grandchildren running).
 */
export async function dev(app: AppDir, serverArgs: string[]): Promise<void> {
  const children: ReturnType<typeof Bun.spawn>[] = [];
  let stopping = false;

  function stop(code: number): void {
    if (stopping) return;
    stopping = true;
    for (const child of children) killTreeSync(child.pid);
    process.exit(code);
  }

  function start(cmd: string[], cwd = app.dir): void {
    const child = Bun.spawn(cmd, { cwd, stdio: ['inherit', 'inherit', 'inherit'] });
    children.push(child);
    void child.exited.then((code) => stop(code ?? 0));
  }

  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));

  // From the workspace root: `bun --watch` only watches files inside its project folder, and the
  // server's code is mostly in packages/.
  const root = await workspaceRoot(app.dir);
  start(['bun', '--watch', relative(root, join(app.dir, 'server/main.ts')), '--dev', ...serverArgs], root);
  await waitForUrl(`http://127.0.0.1:${DEV_PORT}/`, { timeoutMs: WAIT_MS, until: () => stopping });
  if (stopping) return;
  // Vite would clear the terminal, and with it the server's line with the URL (and launch code) to open.
  start(['bun', 'x', 'vite', '--port', String(VITE_PORT), '--strictPort', '--clearScreen', 'false']);
}
