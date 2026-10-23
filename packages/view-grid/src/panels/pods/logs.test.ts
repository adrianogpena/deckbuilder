import { describe, expect, test } from 'bun:test';
import { detectLevel, LineSplitter, parseTail, PodLogHub, RingBuffer, validateTarget, type LogChild, type LogMessage } from './logs';

describe('RingBuffer', () => {
  test('drops the oldest lines', () => {
    const r = new RingBuffer(3);
    r.push(['a', 'b']);
    r.push(['c', 'd']);
    expect(r.last(10)).toEqual(['b', 'c', 'd']);
    expect(r.last(2)).toEqual(['c', 'd']);
    expect(r.last(0)).toEqual([]);
  });
});

describe('LineSplitter', () => {
  test('joins a line split across chunks', () => {
    const s = new LineSplitter();
    expect(s.push('one\ntw')).toEqual(['one']);
    expect(s.push('o\r\nthree')).toEqual(['two']);
    expect(s.flush()).toEqual(['three']);
  });
});

describe('detectLevel', () => {
  test('finds levels and stack traces', () => {
    expect(detectLevel('2024 ERROR boom')).toBe('error');
    expect(detectLevel('WARN slow')).toBe('warn');
    expect(detectLevel('INFO request failed ERROR')).toBe('info');
    expect(detectLevel('DEBUG x')).toBe('debug');
    expect(detectLevel('   at com.foo.Bar(Bar.java:1)')).toBe('error');
    expect(detectLevel('plain')).toBeNull();
  });
});

describe('validateTarget / parseTail', () => {
  test('validates names', () => {
    expect(validateTarget({ context: 'ctx', namespace: 'ns', pod: 'api-1' })).not.toBeNull();
    expect(validateTarget({ context: 'ctx', namespace: 'n s', pod: 'api-1' })).toBeNull();
    expect(validateTarget({ context: 'ctx', namespace: 'ns', pod: 'API_1' })).toBeNull();
  });
  test('clamps the tail', () => {
    expect(parseTail(null)).toBe(500);
    expect(parseTail('99999')).toBe(5000);
    expect(parseTail('20')).toBe(20);
  });
});

describe('PodLogHub', () => {
  test('shares one child and kills it after the grace period', async () => {
    let spawned = 0;
    let killed = 0;
    let push: (s: string) => void = () => {};
    const spawn = (): LogChild => {
      spawned++;
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      const stdout = new ReadableStream<Uint8Array>({ start: (c) => { ctrl = c; } });
      push = (s) => ctrl.enqueue(new TextEncoder().encode(s));
      return { stdout, stderr: new ReadableStream(), exited: new Promise<number>(() => {}), kill: () => { killed++; } };
    };
    const hub = new PodLogHub({ spawn, graceMs: 20, staleMs: 100000 });
    const target = { context: 'c', namespace: 'n', pod: 'p' };
    const a: LogMessage[] = [];
    const b: LogMessage[] = [];
    const leaveA = hub.subscribe(target, 500, (m) => a.push(m));
    push('hello\nwor');
    await Bun.sleep(10);
    const leaveB = hub.subscribe(target, 500, (m) => b.push(m));
    expect(spawned).toBe(1);
    expect(b[0]).toEqual({ lines: ['hello'] });
    leaveA();
    leaveB();
    expect(hub.active()).toBe(1);
    await Bun.sleep(60);
    expect(killed).toBe(1);
    expect(hub.active()).toBe(0);
  });
});
