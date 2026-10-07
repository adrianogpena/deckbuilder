import { spawn } from 'node:child_process';

export type RunResult = { kind: 'done'; code: number; stdout: string; stderr: string } | { kind: 'timeout' };

/** Runs a command and collects its output; faked in tests. */
export type Runner = (cmd: string[], timeoutMs: number) => Promise<RunResult>;

export const runWithTimeout: Runner = async (cmd, timeoutMs) => {
  const proc = Bun.spawn(cmd, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const done = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const result = await Promise.race([done, timedOut]);
  clearTimeout(timer);
  if (result === 'timeout') {
    killTree(proc.pid);
    return { kind: 'timeout' };
  }
  const [stdout, stderr, code] = result;
  return { kind: 'done', code, stdout, stderr };
};

/**
 * Kills a child process and everything it spawned. Shims (scoop, Chocolatey) run the real exe as
 * their own child, so a plain kill would leave that one alive.
 */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    Bun.spawn(['taskkill', '/PID', String(pid), '/T', '/F'], { stdout: 'ignore', stderr: 'ignore', windowsHide: true });
  } else {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
}

/**
 * Starts `argv` outside this process's job object, so it outlives this process. Resolves once it
 * started; rejects when it could not (e.g. missing exe).
 */
export function startDetached(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (!cmd) return Promise.reject(new Error('empty command'));
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('spawn', () => resolve());
    child.once('error', reject);
    child.unref();
  });
}
