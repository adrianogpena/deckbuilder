import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { renameWithRetry } from './rename-retry.ts';

/** Tail of each file's write queue, keyed by absolute path: writes to one file never overlap. */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(file: string, job: () => Promise<T>): Promise<T> {
  const key = resolve(file);
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(job);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/** Writes `data` to a temp file beside `file`, then renames it over the target; a crash never leaves a half-written file. */
export function writeFileAtomic(file: string, data: string | Uint8Array | Blob | ReadableStream<Uint8Array>): Promise<void> {
  return enqueue(file, async () => {
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
    try {
      if (typeof data === 'string' || data instanceof Uint8Array) await writeFile(tmp, data);
      else {
        // Bun.write(path, blob) copies a sliced file whole; the writer streams just the slice.
        const out = Bun.file(tmp).writer();
        try {
          for await (const chunk of data instanceof Blob ? data.stream() : data) out.write(chunk);
        } catch (err) {
          await Promise.resolve(out.end()).catch(() => {});
          throw err;
        }
        await out.end();
      }
      await renameWithRetry(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  });
}

/** `JSON.stringify(value, null, 2)` plus a newline, written atomically. */
export function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Reads and parses a JSON file. A missing file gives undefined; other read errors (EACCES, EISDIR) throw.
 * A file that doesn't parse, or that `accept` rejects, is renamed to `<file>.corrupt-<epoch ms>`, reported
 * on stderr, and gives undefined, so the next write doesn't silently destroy it.
 */
export async function readJsonFile(file: string, accept?: (value: unknown) => boolean): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!accept || accept(value)) return value;
  } catch {
    // falls through to the quarantine below
  }
  const aside = `${file}.corrupt-${Date.now()}`;
  console.error(`Unreadable JSON file moved aside: ${file} -> ${aside}`);
  await rename(file, aside).catch(() => {});
  return undefined;
}
