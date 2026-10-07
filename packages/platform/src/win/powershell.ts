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

/** JSON with non-ASCII \u-escaped, so the console code page of a host can't mangle it. */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Calls `onLine` with each trimmed, non-empty line of a host's output stream. */
export async function forEachLine(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  let buffered = '';
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) if (line.trim() !== '') onLine(line.trim());
  }
  if (buffered.trim() !== '') onLine(buffered.trim());
}

/**
 * A PowerShell single-quoted string literal. Only quotes need escaping, by doubling them, and
 * PowerShell takes the typographic single quotes as quotes too.
 */
export function psQuote(text: string): string {
  return `'${text.replace(/['‘’‚‛]/g, '$&$&')}'`;
}
