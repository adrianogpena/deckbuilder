// Manual harness: bun packages/terminal/src/server/pty-demo.ts [claude]
import { spawnPty } from './pty.ts';

const arg = process.argv[2];
const cmd =
  arg === 'claude'
    ? [Bun.which('claude') ?? 'claude']
    : process.platform === 'win32'
      ? ['powershell.exe', '-NoLogo']
      : [process.env.SHELL ?? '/bin/sh'];

const size = () => ({ cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 });
const { cols, rows } = size();
const pty = spawnPty(cmd, process.cwd(), cols, rows);

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (d) => pty.write(d));
process.stdout.on('resize', () => {
  const s = size();
  pty.resize(s.cols, s.rows);
});
pty.onData((d) => process.stdout.write(d));
pty.onExit((code) => {
  process.stdin.setRawMode?.(false);
  process.exit(code ?? 0);
});
