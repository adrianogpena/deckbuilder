import { SourceError } from './connections/errors';

export interface CliOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `argv` without a shell; kills it on timeout or abort. Throws `tool-missing` when `argv[0]` is not installed. */
export async function runCli(argv: string[], { timeoutMs, signal }: CliOptions): Promise<CliResult> {
  const tool = argv[0] ?? '';
  if (!tool || !Bun.which(tool)) throw SourceError('tool-missing', `A required tool is not installed: ${tool}.`, undefined, { tool });
  const proc = Bun.spawn(argv, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const kill = () => proc.kill();
  const timer = setTimeout(kill, timeoutMs);
  signal?.addEventListener('abort', kill, { once: true });
  if (signal?.aborted) kill();
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', kill);
  }
}
