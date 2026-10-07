import { DEV_PORT, VITE_PORT } from '@deckbuilder/server-core/protocol';
import { join, relative } from 'node:path';
import { type AppDir, workspaceRoot } from './app.ts';

const WAIT_MS = 30_000;

/**
 * Runs the server in watch mode (`--dev`: port 7420, token "dev") and the Vite dev server,
 * which proxies /api to it. Vite starts once the server answers, so the first page load
 * doesn't hit a closed port. Ctrl+C stops both process trees (on Windows a plain kill
 * leaves the grandchildren running).
 */
export async function dev(app: AppDir, serverArgs: string[]): Promise<void> {
  const children: ReturnType<typeof Bun.spawn>[] = [];
  let stopping = false;

  function stop(code: number): void {
    if (stopping) return;
    stopping = true;
    for (const child of children) {
      if (process.platform === 'win32') {
        Bun.spawnSync(['taskkill', '/PID', String(child.pid), '/T', '/F'], { stdio: ['ignore', 'ignore', 'ignore'] });
      } else {
        child.kill();
      }
    }
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
  const deadline = Date.now() + WAIT_MS;
  while (!stopping && Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${DEV_PORT}/`);
      break;
    } catch {
      await Bun.sleep(200);
    }
  }
  if (stopping) return;
  start(['bun', 'x', 'vite', '--port', String(VITE_PORT), '--strictPort']);
}
