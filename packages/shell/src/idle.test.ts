import { expect, test } from 'bun:test';
import { createIdleWatch } from './idle.ts';

function clock() {
  let time = 0;
  let tick: (() => void) | null = null;
  let interval = 0;
  return {
    now: () => time,
    setInterval: (fn: () => void, ms: number) => {
      tick = fn;
      interval = ms;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
    advance(ms: number) {
      for (let t = interval; t <= ms; t += interval) {
        time += interval;
        tick?.();
      }
    },
  };
}

test('fires after the timeout without a touch', () => {
  const c = clock();
  let idle = 0;
  createIdleWatch({ timeoutMs: 60_000, ...c, onIdle: () => idle++ });
  c.advance(30_000);
  expect(idle).toBe(0);
  c.advance(60_000);
  expect(idle).toBe(1);
});

test('a touch starts the timeout over', () => {
  const c = clock();
  let idle = 0;
  const watch = createIdleWatch({ timeoutMs: 60_000, ...c, onIdle: () => idle++ });
  c.advance(30_000);
  watch.touch();
  c.advance(30_000);
  expect(idle).toBe(0);
  c.advance(30_000);
  expect(idle).toBe(1);
});

test('stop cancels', () => {
  const c = clock();
  let idle = 0;
  const watch = createIdleWatch({ timeoutMs: 60_000, ...c, onIdle: () => idle++ });
  watch.stop();
  c.advance(120_000);
  expect(idle).toBe(0);
});
