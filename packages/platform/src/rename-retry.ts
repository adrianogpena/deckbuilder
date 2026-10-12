import { rename as fsRename, stat } from 'node:fs/promises';

const RETRY_CODES = new Set(['EACCES', 'EPERM', 'EBUSY']);

export interface RenameRetryOptions {
  /** How long to keep retrying, in ms; default 10 s. */
  timeoutMs?: number;
  /** Injected in tests. */
  rename?: (from: string, to: string) => Promise<void>;
  platform?: NodeJS.Platform;
}

/**
 * `rename`, retried on Windows while EACCES / EPERM / EBUSY last: antivirus and the search indexer
 * hold a just-written file open for a moment (VS Code retries the same way). A folder at `to` is not
 * retried, since EPERM is then the real answer.
 */
export async function renameWithRetry(from: string, to: string, opts: RenameRetryOptions = {}): Promise<void> {
  const rename = opts.rename ?? fsRename;
  if ((opts.platform ?? process.platform) !== 'win32') return rename(from, to);
  const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (!code || !RETRY_CODES.has(code) || Date.now() >= deadline) throw err;
      if (await stat(to).then((s) => !s.isFile(), () => false)) throw err;
      await Bun.sleep(Math.min(100, attempt * 10));
    }
  }
}
