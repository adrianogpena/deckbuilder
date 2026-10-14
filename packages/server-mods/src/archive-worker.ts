import { run, type SevenZipJob } from './archive.ts';

declare const self: Worker;

// One 7z run per worker: the caller posts a job, gets the result and terminates the worker.
self.onmessage = async (e: MessageEvent<SevenZipJob>) => {
  try {
    const { args, mounts, cwd } = e.data;
    self.postMessage(await run(args, mounts, cwd));
  } catch (err) {
    self.postMessage({ error: (err as Error).message ?? String(err) });
  }
};
