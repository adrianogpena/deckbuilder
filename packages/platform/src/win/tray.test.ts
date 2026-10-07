import { expect, test } from 'bun:test';
import { createTray, type TrayProcess, traySpec } from './tray.ts';

function fakeHost() {
  let out: ReadableStreamDefaultController<Uint8Array> | undefined;
  let err: ReadableStreamDefaultController<Uint8Array> | undefined;
  let resolveExit: (code: number) => void = () => {};
  const host = {
    ended: false,
    scripts: [] as string[],
    print: (text: string) => out?.enqueue(new TextEncoder().encode(text)),
    printError: (text: string) => err?.enqueue(new TextEncoder().encode(text)),
    exit: (code: number) => {
      out?.close();
      err?.close();
      resolveExit(code);
    },
  };
  const spawn = (script: string): TrayProcess => {
    host.scripts.push(script);
    return {
      pid: 1,
      end() {
        host.ended = true;
        host.exit(0);
      },
      stdout: new ReadableStream({
        start: (c) => {
          out = c;
        },
      }),
      stderr: new ReadableStream({
        start: (c) => {
          err = c;
        },
      }),
      exited: new Promise((resolve) => {
        resolveExit = resolve;
      }),
    };
  };
  return { host, spawn };
}

const items = [
  { id: '__open', label: 'Open' },
  { id: '__quit', label: 'Quit' },
];
const tick = () => new Promise((r) => setTimeout(r, 0));

test('the spec escapes mnemonics and makes each entry an ASCII JSON line', () => {
  const spec = traySpec({ tooltip: 'x'.repeat(80), items: [{ id: 'ação', label: 'Tom & Jerry' }] });
  expect(spec.tooltip).toHaveLength(63);
  expect(spec.iconPath).toBeNull();
  expect(spec.items[0]?.label).toBe('Tom && Jerry');
  expect(/^[\x20-\x7e]*$/.test(spec.items[0]?.line ?? '')).toBe(true);
  expect(JSON.parse(spec.items[0]?.line ?? '')).toEqual({ select: 'ação' });
});

test('stdout lines resolve ready and select entries', async () => {
  const { host, spawn } = fakeHost();
  const selected: string[] = [];
  const tray = createTray({ tooltip: 'App', items, spawn, onSelect: (id) => selected.push(id), onError: () => {} });
  expect(tray.supported).toBe(true);
  host.print('{"ready":true}\r\n{"select":"__open"}\r\n{"sel');
  await tray.ready;
  host.print('ect":"__quit"}\r\n');
  await tick();
  expect(selected).toEqual(['__open', '__quit']);
});

test('a garbage line and stderr are reported', async () => {
  const { host, spawn } = fakeHost();
  const errors: string[] = [];
  createTray({ tooltip: 'App', items, spawn, onSelect: () => {}, onError: (m) => errors.push(m) });
  host.print('{"ready":true}\nnot json\n{"other":1}\n');
  host.printError('icon file missing\n');
  await tick();
  expect(errors).toEqual(['unexpected output: not json', 'unexpected output: {"other":1}', 'icon file missing']);
});

test('ready rejects when the host exits before the icon shows', async () => {
  const { host, spawn } = fakeHost();
  const tray = createTray({ tooltip: 'App', items, spawn, onSelect: () => {}, onError: () => {} });
  host.exit(1);
  await expect(tray.ready).rejects.toThrow('exited with code 1');
});

test('close ends stdin and resolves once the host exited', async () => {
  const { host, spawn } = fakeHost();
  const errors: string[] = [];
  const tray = createTray({ tooltip: 'App', items, spawn, onSelect: () => {}, onError: (m) => errors.push(m) });
  host.print('{"ready":true}\n');
  await tray.ready;
  await tray.close();
  expect(host.ended).toBe(true);
  expect(errors).toEqual([]);
  expect(host.scripts).toHaveLength(1);
});
