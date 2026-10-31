// `bun run dev:design`: the dev window with the design-preview flag on (`import.meta.env.VITE_KEDALION_DESIGN`).
// Design variants and unfinished buttons only render under this flag; extra args go to `kedalion dev`.
const proc = Bun.spawn(['bun', 'run', '--cwd', 'app', 'dev:window', ...process.argv.slice(2)], {
  env: { ...process.env, VITE_KEDALION_DESIGN: '1' },
  stdio: ['inherit', 'inherit', 'inherit'],
});
process.on('SIGINT', () => proc.kill());
process.exit(await proc.exited);
