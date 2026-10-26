import { describe, expect, test } from 'bun:test';
import { sharedCall } from './client';
import { mapLimit } from './limit';

describe('mapLimit', () => {
  test('keeps the order and never exceeds the limit', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10 - n));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});

describe('sharedCall', () => {
  test('identical concurrent calls share one request and are cached', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return 'x';
    };
    const [a, b] = await Promise.all([sharedCall('k1', run), sharedCall('k1', run)]);
    expect([a, b, await sharedCall('k1', run), calls]).toEqual(['x', 'x', 'x', 1]);
  });

  test('one waiter aborting does not reject the other', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 'y';
    };
    const ac = new AbortController();
    const first = sharedCall('k2', run, ac.signal);
    const second = sharedCall('k2', run);
    ac.abort(new Error('gone'));
    await expect(first).rejects.toThrow('gone');
    expect(await second).toBe('y');
    expect(calls).toBe(1);
  });

  test('failures are not cached', async () => {
    let calls = 0;
    const run = async () => {
      if (++calls === 1) throw new Error('boom');
      return 'ok';
    };
    await expect(sharedCall('k3', run)).rejects.toThrow('boom');
    expect(await sharedCall('k3', run)).toBe('ok');
  });
});
