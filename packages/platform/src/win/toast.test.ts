import { expect, test } from 'bun:test';
import { createToaster, type ToastProcess, toastLine, toastXml } from './toast.ts';

test('XML escapes title, body and launch', () => {
  expect(toastXml({ title: 'Fix <thing> & "stuff"', body: "it's red", launch: 'https://x.test/?a=1&b=2' })).toBe(
    '<toast activationType="protocol" launch="https://x.test/?a=1&amp;b=2">' +
      '<visual><binding template="ToastGeneric">' +
      '<text>Fix &lt;thing&gt; &amp; &quot;stuff&quot;</text>' +
      '<text>it&apos;s red</text>' +
      '</binding></visual></toast>',
  );
  expect(toastXml({ title: 'T', body: '', launch: 'x' })).toContain('<binding template="ToastGeneric"><text>T</text></binding>');
});

test('a stdin line is one line of ASCII JSON carrying the XML', () => {
  const line = toastLine({ title: 'Ação ✅', body: 'a\nb', launch: 'x' });
  expect(line.endsWith('\n')).toBe(true);
  expect(/^[\x20-\x7e]*\n$/.test(line)).toBe(true);
  expect(JSON.parse(line).xml).toContain('<text>Ação ✅</text><text>a\nb</text>');
});

interface FakeProc {
  lines: string[];
  exit: (code: number) => void;
}

function fakeSpawn() {
  const procs: FakeProc[] = [];
  const spawn = (): ToastProcess => {
    let errors: ReadableStreamDefaultController<Uint8Array> | undefined;
    let dead = false;
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const proc: FakeProc = {
      lines: [],
      exit: (code) => {
        dead = true;
        errors?.close();
        resolveExit(code);
      },
    };
    procs.push(proc);
    return {
      pid: procs.length,
      write(line) {
        if (dead) throw new Error('EPIPE');
        proc.lines.push(line);
      },
      end: () => proc.exit(0),
      stderr: new ReadableStream({
        start: (c) => {
          errors = c;
        },
      }),
      exited,
    };
  };
  return { spawn, procs };
}

const toast = (title: string) => ({ title, body: '', launch: 'x' });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('one long-lived process gets one line per toast', () => {
  const { spawn, procs } = fakeSpawn();
  const toaster = createToaster({ spawn, onError: () => {} });
  toaster.show(toast('a'));
  toaster.show(toast('b'));
  expect(procs).toHaveLength(1);
  expect(procs[0]?.lines.map((l) => JSON.parse(l).xml)).toEqual([toastXml(toast('a')), toastXml(toast('b'))]);
});

test('the process is restarted after it exits', async () => {
  const { spawn, procs } = fakeSpawn();
  const errors: string[] = [];
  const toaster = createToaster({ spawn, onError: (m) => errors.push(m) });
  toaster.show(toast('a'));
  procs[0]?.exit(1);
  await tick();
  toaster.show(toast('b'));
  expect(procs).toHaveLength(2);
  expect(procs[1]?.lines).toHaveLength(1);
  expect(errors).toEqual(['toast host exited with code 1']);
});

test('a write to a dead process not yet seen as exited retries on a new one', () => {
  const { spawn, procs } = fakeSpawn();
  const toaster = createToaster({ spawn, onError: () => {} });
  toaster.show(toast('a'));
  procs[0]?.exit(1);
  toaster.show(toast('b'));
  expect(procs.map((p) => p.lines.length)).toEqual([1, 1]);
});

test('stderr lines are reported; close ends stdin and returns the exit code', async () => {
  const errors: string[] = [];
  let ended = false;
  let resolveExit: (code: number) => void = () => {};
  const toaster = createToaster({
    spawn: () => ({
      pid: 1,
      write() {},
      end() {
        ended = true;
        resolveExit(0);
      },
      stderr: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('bad xml\r\nsecond'));
          c.close();
        },
      }),
      exited: new Promise((resolve) => {
        resolveExit = resolve;
      }),
    }),
    onError: (m) => errors.push(m),
  });
  expect(await toaster.close()).toBeNull();
  toaster.show(toast('a'));
  expect(await toaster.close()).toBe(0);
  expect(ended).toBe(true);
  expect(errors).toEqual(['bad xml', 'second']);
});
