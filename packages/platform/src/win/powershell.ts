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
