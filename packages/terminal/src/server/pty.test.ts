import { describe, expect, test } from 'bun:test';
import { spawnPty, type Pty } from './pty.ts';

const win = process.platform === 'win32';
const decoder = new TextDecoder();

function collect(pty: Pty) {
  const state = { text: '', code: undefined as number | null | undefined };
  pty.onData((d) => (state.text += decoder.decode(d, { stream: true })));
  pty.onExit((c) => (state.code = c));
  return state;
}

async function until(cond: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout');
    await Bun.sleep(25);
  }
}

const cwd = process.cwd();

describe.skipIf(!win)('pty on Windows', () => {
  test('cmd output arrives', async () => {
    const pty = spawnPty(['cmd', '/d', '/c', 'echo hi'], cwd, 80, 24);
    const s = collect(pty);
    await until(() => s.code !== undefined);
    expect(s.text).toContain('hi');
    expect(s.code).toBe(0);
  });

  test('pwsh sees a console and follows resize', async () => {
    const pty = spawnPty(['powershell.exe', '-NoLogo', '-NoProfile'], cwd, 80, 24);
    const s = collect(pty);
    pty.write('[Console]::IsInputRedirected\r');
    await until(() => /False/.test(s.text));
    pty.resize(120, 30);
    pty.write('"w=" + $Host.UI.RawUI.WindowSize.Width + "="\r');
    await until(() => /w=120=/.test(s.text));
    pty.kill();
    await until(() => s.code !== undefined);
  });

  test('exit code is the process code', async () => {
    const pty = spawnPty(['cmd', '/d', '/c', 'exit 3'], cwd, 80, 24);
    const s = collect(pty);
    await until(() => s.code !== undefined);
    expect(s.code).toBe(3);
  });

  test('kill ends the tree', async () => {
    const pty = spawnPty(['cmd', '/d', '/k', 'ping -t localhost'], cwd, 80, 24);
    const s = collect(pty);
    await until(() => /Reply from/.test(s.text));
    pty.kill();
    await until(() => s.code !== undefined);
    await Bun.sleep(500);
    const out = Bun.spawnSync(['tasklist', '/FI', 'IMAGENAME eq PING.EXE', '/NH']).stdout.toString();
    expect(out).not.toMatch(/ping\.exe/i);
  });
});

describe.skipIf(win)('pty on POSIX', () => {
  test('tty is a pts', async () => {
    const pty = spawnPty(['sh', '-c', 'tty'], cwd, 80, 24);
    const s = collect(pty);
    await until(() => s.code !== undefined);
    expect(s.text).toMatch(/\/dev\/pts\//);
  });

  test('resize reaches stty', async () => {
    const pty = spawnPty(['sh'], cwd, 80, 24);
    const s = collect(pty);
    pty.resize(100, 30);
    await Bun.sleep(200);
    pty.write('stty size\n');
    await until(() => /30 100/.test(s.text));
    pty.kill();
    await until(() => s.code !== undefined);
  });

  test('exit code is the process code', async () => {
    const pty = spawnPty(['sh', '-c', 'exit 3'], cwd, 80, 24);
    const s = collect(pty);
    await until(() => s.code !== undefined);
    expect(s.code).toBe(3);
  });

  test('kill fires onExit', async () => {
    const pty = spawnPty(['sh', '-c', 'sleep 60'], cwd, 80, 24);
    const s = collect(pty);
    await Bun.sleep(200);
    pty.kill();
    await until(() => s.code !== undefined);
  });
});
