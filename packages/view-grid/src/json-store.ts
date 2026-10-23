import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface JsonStoreOptions<T> {
  dataDir: string;
  /** File name without extension, under `<dataDir>/grid/`. */
  name: string;
  /** Checks and cleans what was read from disk. */
  parse(raw: unknown): T;
  empty(): T;
}

export interface JsonStore<T> {
  read(): Promise<T>;
  /** Applies `fn` to the current value and saves the result; calls run one after another. */
  update(fn: (value: T) => T): Promise<T>;
}

/** A JSON file `<dataDir>/grid/<name>.json`: writes are serialized and atomic (tmp file + rename). */
export function createJsonStore<T>({ dataDir, name, parse, empty }: JsonStoreOptions<T>): JsonStore<T> {
  const dir = join(dataDir, 'grid');
  const file = join(dir, `${name}.json`);
  let queue: Promise<unknown> = Promise.resolve();

  const read = async (): Promise<T> => {
    try {
      return parse(JSON.parse(await readFile(file, 'utf8')));
    } catch {
      return empty();
    }
  };
  const write = async (value: T) => {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2));
    await rename(tmp, file);
  };
  const locked = <R>(job: () => Promise<R>): Promise<R> => {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  };

  return {
    read: () => locked(read),
    update: (fn) =>
      locked(async () => {
        const next = fn(await read());
        await write(next);
        return next;
      }),
  };
}
