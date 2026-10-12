import { expect, test } from 'bun:test';
import { renameWithRetry } from './rename-retry.ts';

const failing = (codes: string[]) => {
  const calls: string[] = [];
  const rename = async (from: string) => {
    calls.push(from);
    const code = codes.shift();
    if (code) throw Object.assign(new Error(code), { code });
  };
  return { calls, rename };
};

test('retries a locked rename on Windows until it succeeds', async () => {
  const fake = failing(['EBUSY', 'EPERM']);
  await renameWithRetry('a', 'b', { rename: fake.rename, platform: 'win32' });
  expect(fake.calls).toHaveLength(3);
});

test('gives up after the timeout', async () => {
  const fake = failing(Array(1000).fill('EACCES'));
  await expect(renameWithRetry('a', 'b', { rename: fake.rename, platform: 'win32', timeoutMs: 50 })).rejects.toMatchObject({ code: 'EACCES' });
});

test('does not retry other errors or other platforms', async () => {
  const enoent = failing(['ENOENT']);
  await expect(renameWithRetry('a', 'b', { rename: enoent.rename, platform: 'win32' })).rejects.toMatchObject({ code: 'ENOENT' });
  expect(enoent.calls).toHaveLength(1);
  const linux = failing(['EBUSY']);
  await expect(renameWithRetry('a', 'b', { rename: linux.rename, platform: 'linux' })).rejects.toMatchObject({ code: 'EBUSY' });
  expect(linux.calls).toHaveLength(1);
});
