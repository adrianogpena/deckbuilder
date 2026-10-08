type Stream = 'pipe' | 'ignore';

/**
 * Starts Windows PowerShell 5.1 (never pwsh: PowerShell 7 dropped WinRT projection) on `script`,
 * hidden. The script goes in -EncodedCommand, so multi-line scripts and C# here-strings need no
 * quoting and stdin stays free for data (callers write JSON lines to it). `sta` adds -STA
 * (WinForms). stderr is always piped. No timeout: callers that need one use `killTree`.
 */
export function spawnPowerShell<In extends Stream = 'ignore', Out extends Stream = 'pipe'>(
  script: string,
  opts: { sta?: boolean; stdin?: In; stdout?: Out } = {},
): Bun.Subprocess<In, Out, 'pipe'> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const argv = ['powershell.exe', '-NoProfile', '-NonInteractive', ...(opts.sta ? ['-STA'] : []), '-EncodedCommand', encoded];
  return Bun.spawn(argv, {
    stdin: opts.stdin ?? 'ignore',
    stdout: opts.stdout ?? 'pipe',
    stderr: 'pipe',
    windowsHide: true,
  }) as Bun.Subprocess<In, Out, 'pipe'>;
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
