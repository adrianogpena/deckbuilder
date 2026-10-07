import { rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

/** True inside a `bun build --compile` exe, false when running from source with bun. */
export function isCompiledExe(execPath = process.execPath): boolean {
  return !/^(bun|node)(\.exe)?$/i.test(basename(execPath));
}

/**
 * Files next to the exe during a self-update: `fresh` is the downloaded release, `old` the
 * running exe moved aside (Windows allows renaming a running exe, not replacing it).
 */
export function updatePaths(execPath: string): { fresh: string; old: string } {
  const ext = extname(execPath);
  const stem = join(dirname(execPath), basename(execPath, ext));
  return { fresh: `${stem}.new${ext}`, old: `${stem}.old${ext}` };
}

/**
 * Run by the new exe (`--after-update`) before anything else: deleting the old exe fails while
 * the old process still runs, so success means it has exited. Gives up after `timeoutMs` (false),
 * leaving the file for the next update to remove.
 */
export async function removeOldExe(
  execPath: string,
  opts: { remove?: (path: string) => Promise<void>; timeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const remove = opts.remove ?? ((path: string) => rm(path, { force: true }));
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const pollMs = opts.pollMs ?? 250;
  const tries = Math.max(1, Math.ceil((opts.timeoutMs ?? 30_000) / pollMs));
  const { old } = updatePaths(execPath);
  for (let i = 0; i < tries; i++) {
    try {
      await remove(old);
      return true;
    } catch {
      await sleep(pollMs);
    }
  }
  return false;
}
