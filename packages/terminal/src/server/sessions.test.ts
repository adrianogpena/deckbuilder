import { describe, expect, test } from 'bun:test';
import type { Pty } from './pty.ts';
import { terminalSessions, type Sink } from './sessions.ts';

class FakePty implements Pty {
  written: Array<string | Uint8Array> = [];
  size = [0, 0];
  killed = false;
  private data: Array<(d: Uint8Array) => void> = [];
  private exit: Array<(c: number | null) => void> = [];
  write(d: string | Uint8Array) {
    this.written.push(d);
  }
  resize(c: number, r: number) {
    this.size = [c, r];
  }
  kill() {
    this.killed = true;
  }
  onData(cb: (d: Uint8Array) => void) {
    this.data.push(cb);
  }
  onExit(cb: (c: number | null) => void) {
    this.exit.push(cb);
  }
  emit(text: string) {
    for (const cb of this.data) cb(new TextEncoder().encode(text));
  }
  end(code: number | null) {
    for (const cb of this.exit) cb(code);
  }
}

class FakeSink implements Sink {
  frames: Array<string | Uint8Array> = [];
  closed = false;
  send(f: string | Uint8Array) {
    this.frames.push(f);
  }
  close() {
    this.closed = true;
  }
  get text() {
    return this.frames.map((f) => (typeof f === 'string' ? f : new TextDecoder().decode(f))).join('');
  }
  messages() {
    return this.frames.filter((f): f is string => typeof f === 'string' && f.startsWith('{')).map((f) => JSON.parse(f));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20));

function setup(opts: { max?: number; now?: () => number } = {}) {
  const ptys: FakePty[] = [];
  const reg = terminalSessions({
    spawn: () => {
      const p = new FakePty();
      ptys.push(p);
      return p;
    },
    ...opts,
  });
  const make = (extra = {}) => reg.create({ cmd: ['sh'], cwd: '/tmp', cols: 80, rows: 24, label: 'sh', ...extra });
  return { reg, ptys, make };
}

describe('terminalSessions', () => {
  test('output while detached is replayed on attach, then live output follows', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    ptys[0]!.emit('hello\r\n');
    await settle();
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    ptys[0]!.emit('live');
    await settle();
    expect(sink.messages()[0]).toEqual({ type: 'hello', session: s.id, cols: 80, rows: 24 });
    expect(sink.text).toContain('hello');
    expect(sink.text.endsWith('live')).toBe(true);
  });

  test('a second interactive attach closes the first, a preview does not', async () => {
    const { reg, make } = setup();
    const s = make();
    const a = new FakeSink();
    const b = new FakeSink();
    const p = new FakeSink();
    reg.attach(s.id, a, 'interactive');
    reg.attach(s.id, p, 'preview');
    expect(a.closed).toBe(false);
    reg.attach(s.id, b, 'interactive');
    await settle();
    expect(a.closed).toBe(true);
    expect(p.closed).toBe(false);
    expect(b.closed).toBe(false);
    expect(reg.list()[0]!.viewers).toEqual({ interactive: true, previews: 1 });
  });

  test('preview input and resize are ignored, interactive ones act', () => {
    const { reg, ptys, make } = setup();
    const s = make();
    const i = new FakeSink();
    const p = new FakeSink();
    reg.attach(s.id, i, 'interactive');
    reg.attach(s.id, p, 'preview');
    reg.write(s.id, p, 'x');
    reg.resize(s.id, p, 10, 10);
    reg.close(s.id, p);
    expect(ptys[0]!.written).toEqual([]);
    expect(ptys[0]!.size).toEqual([0, 0]);
    expect(reg.get(s.id)).toBeDefined();
    reg.write(s.id, i, 'y');
    reg.resize(s.id, i, 100, 30);
    expect(ptys[0]!.written).toEqual(['y']);
    expect(ptys[0]!.size).toEqual([100, 30]);
    expect(reg.list()[0]).toMatchObject({ cols: 100, rows: 30 });
  });

  test('exit while detached is reported on attach', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    ptys[0]!.end(3);
    await settle();
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    await settle();
    expect(sink.messages().filter((m) => m.type === 'exit')).toEqual([{ type: 'exit', code: 3 }]);
    expect(reg.list()[0]!.exited).toBe(3);
  });

  test('exit is sent once to attached sinks and the session stays until close', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    await settle();
    ptys[0]!.end(0);
    await settle();
    expect(sink.messages().filter((m) => m.type === 'exit')).toEqual([{ type: 'exit', code: 0 }]);
    expect(reg.get(s.id)).toBeDefined();
  });

  test('close kills, closes sinks and removes; closeAll kills all', () => {
    const { reg, ptys, make } = setup();
    const a = make();
    const b = make();
    const sink = new FakeSink();
    reg.attach(a.id, sink, 'interactive');
    reg.close(a.id);
    expect(ptys[0]!.killed).toBe(true);
    expect(sink.closed).toBe(true);
    expect(reg.get(a.id)).toBeUndefined();
    reg.closeAll();
    expect(ptys[1]!.killed).toBe(true);
    expect(reg.get(b.id)).toBeUndefined();
    expect(reg.list()).toEqual([]);
  });

  test('refuses a session beyond max', () => {
    const { make } = setup({ max: 2 });
    make();
    make();
    expect(() => make()).toThrow(expect.objectContaining({ code: 'terminalLimit' }));
  });

  test('headless answers queries only while no interactive client is attached', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    ptys[0]!.emit('\x1b[6n');
    await settle();
    expect(ptys[0]!.written.length).toBe(1);
    reg.attach(s.id, new FakeSink(), 'interactive');
    ptys[0]!.emit('\x1b[6n');
    await settle();
    expect(ptys[0]!.written.length).toBe(1);
  });

  test('replay restores the alternate screen without the queries', async () => {
    const { reg, ptys, make } = setup();
    const s = make();
    ptys[0]!.emit('\x1b[?1049h\x1b[Halt\x1b[6n');
    await settle();
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'preview');
    await settle();
    expect(sink.text).toContain('\x1b[?1049h');
    expect(sink.text).not.toContain('\x1b[6n');
  });
});

describe('session info', () => {
  test('title, bells and lastOutputAt', async () => {
    let t = 1000;
    const { reg, ptys, make } = setup({ now: () => t });
    const s = make({ launcher: 'claude', meta: { id: 'abc' } });
    const sink = new FakeSink();
    reg.attach(s.id, sink, 'interactive');
    await settle();
    expect(reg.list()[0]).toMatchObject({ label: 'sh', launcher: 'claude', meta: { id: 'abc' }, cwd: '/tmp', createdAt: 1000, lastOutputAt: 1000, bells: 0, title: '' });
    t = 2000;
    ptys[0]!.emit('\x1b]0;x\x07\x07');
    await settle();
    expect(reg.list()[0]).toMatchObject({ title: 'x', bells: 1, lastOutputAt: 2000 });
    expect(sink.messages()).toContainEqual({ type: 'title', title: 'x' });
  });

  test('oversized meta is refused', () => {
    const { reg, make } = setup();
    expect(() => make({ meta: { big: 'x'.repeat(5000) } })).toThrow(expect.objectContaining({ code: 'terminalMeta' }));
    const s = make();
    expect(() => reg.setMeta(s.id, { big: 'x'.repeat(5000) })).toThrow(expect.objectContaining({ code: 'terminalMeta' }));
  });

  test('setLabel and setMeta show in list()', () => {
    const { reg, make } = setup();
    const s = make();
    reg.setLabel(s.id, 'renamed');
    reg.setMeta(s.id, { a: 1 });
    expect(reg.list()[0]).toMatchObject({ label: 'renamed', meta: { a: 1 } });
  });
});
