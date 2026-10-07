import { killTree, type RunResult } from '../run.ts';

const TIMEOUT_MS = 15_000;

// Windows PowerShell 5.1, never `pwsh`: PowerShell 7 dropped WinRT type projection. The script
// comes on stdin (`-Command -`) so secrets in it never show up in the process list.
export const POWERSHELL_ARGV = ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', '-'];

export type PowerShell = (script: string) => Promise<RunResult>;

export interface SpawnedProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}

export type Spawn = (argv: string[], stdin: string) => SpawnedProcess;

const bunSpawn: Spawn = (argv, stdin) =>
  Bun.spawn(argv, { stdin: new TextEncoder().encode(stdin), stdout: 'pipe', stderr: 'pipe', windowsHide: true });

export function createPowerShell(spawn: Spawn = bunSpawn, timeoutMs = TIMEOUT_MS): PowerShell {
  return async (script) => {
    // `-Command -` runs stdin line by line and waits for a blank line to end a multi-line block,
    // so the script is sent as one line: every statement in it must end with `;`.
    const oneLine = script
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .join(' ');
    const proc = spawn(POWERSHELL_ARGV, `${oneLine}\r\n`);
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
}

/**
 * A PowerShell single-quoted string literal. Only quotes need escaping, by doubling them, and
 * PowerShell takes the typographic single quotes as quotes too.
 */
export function psQuote(text: string): string {
  return `'${text.replace(/['‘’‚‛]/g, '$&$&')}'`;
}
