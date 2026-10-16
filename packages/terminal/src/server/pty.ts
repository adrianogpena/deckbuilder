import { killTree } from '@deckbuilderkit/platform';

export interface Pty {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: Uint8Array) => void): void;
  onExit(cb: (code: number | null) => void): void;
}

/** One backend for every platform: Bun's built-in terminal (a PTY, ConPTY on Windows). */
export function spawnPty(
  cmd: string[],
  cwd: string,
  cols: number,
  rows: number,
  env?: Record<string, string>,
): Pty {
  const dataCbs: Array<(data: Uint8Array) => void> = [];
  const exitCbs: Array<(code: number | null) => void> = [];
  // Output that arrives before the owner subscribes (the shell's first prompt) is kept.
  let pending: Uint8Array[] | null = [];
  let exitCode: number | null | undefined;

  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    windowsHide: true,
    terminal: {
      cols,
      rows,
      data(_terminal, data) {
        if (pending) pending.push(data);
        else for (const cb of dataCbs) cb(data);
      },
    },
  });

  proc.exited.then(
    (code) => finish(code),
    () => finish(null),
  );

  function finish(code: number | null): void {
    if (exitCode !== undefined) return;
    exitCode = code;
    for (const cb of exitCbs) cb(code);
  }

  return {
    write(data) {
      if (!proc.terminal?.closed) proc.terminal?.write(data);
    },
    resize(c, r) {
      if (!proc.terminal?.closed) proc.terminal?.resize(c, r);
    },
    kill() {
      if (exitCode === undefined) killTree(proc.pid);
      // A plain kill leaves `claude.cmd`'s node holding the PTY; closing it releases the pipe.
      if (!proc.terminal?.closed) proc.terminal?.close();
    },
    onData(cb) {
      dataCbs.push(cb);
      if (pending) {
        const queued = pending;
        pending = null;
        for (const chunk of queued) for (const c of dataCbs) c(chunk);
      }
    },
    onExit(cb) {
      exitCbs.push(cb);
      if (exitCode !== undefined) cb(exitCode);
    },
  };
}
