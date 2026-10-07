// Spike: webview-bun shell. The main thread runs the HTTP server; every window runs in its own
// Worker because Webview.run() blocks its thread. The process exits when the last window closes.
// `--selftest` opens a second window, probes notifications, writes spike-result.json and exits.
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const selftest = process.argv.includes('--selftest');
const compiled = !/bun(\.exe)?$/i.test(process.execPath);
const outDir = compiled ? dirname(process.execPath) : import.meta.dir;
const resultFile = join(outDir, 'spike-result.json');
const logFile = join(outDir, 'spike.log');
const log = (msg: string) => appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
const result: Record<string, unknown> = { shell: 'webview-bun', bun: Bun.version, compiled };

const html = (n: number) => `<!doctype html><html><head><meta charset="utf-8"><title>Window ${n}</title>
<style>body{background:#0d0e11;color:#eceef2;font:14px system-ui;padding:24px}button{margin-right:8px}</style></head>
<body><h1>webview-bun window ${n}</h1>
<button onclick="fetch('/api/new-window',{method:'POST'})">New window</button>
<button onclick="notify()">Notify</button>
<pre id="out"></pre>
<script>
const out = (s) => document.getElementById('out').textContent += s + '\\n';
async function notify() {
  const info = { hasApi: 'Notification' in window, permission: window.Notification?.permission };
  try {
    if (info.hasApi && Notification.permission !== 'granted') info.requested = await Promise.race([
      Notification.requestPermission(), new Promise((r) => setTimeout(() => r('timeout'), 3000))]);
    if (info.hasApi && Notification.permission === 'granted') { new Notification('Spike', { body: 'Hello from webview-bun' }); info.shown = true; }
  } catch (e) { info.error = String(e); }
  out(JSON.stringify(info));
  await fetch('/api/report', { method: 'POST', body: JSON.stringify({ notification: info }) });
}
fetch('/api/report', { method: 'POST', body: JSON.stringify({ ready: ${n}, ua: navigator.userAgent }) });
${n === 1 && selftest ? "setTimeout(() => fetch('/api/new-window',{method:'POST'}), 300); setTimeout(notify, 600);" : ''}
</script></body></html>`;

let windows = 0;
let opened = 0;

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/api/new-window') {
      openWindow();
      return Response.json({ ok: true });
    }
    if (url.pathname === '/api/report') {
      const body = await req.json();
      if (body.ready) {
        result[`window${body.ready}ReadyMs`] = Math.round(process.uptime() * 1000);
        result.userAgent = body.ua;
      }
      if (body.notification) result.notification = body.notification;
      log(JSON.stringify(body));
      if (selftest && result.window2ReadyMs && result.notification) finish();
      return Response.json({ ok: true });
    }
    const n = Number(url.searchParams.get('w') ?? 1);
    return new Response(html(n), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
});

function openWindow() {
  const n = ++opened;
  windows++;
  const worker = new Worker(new URL('./window.ts', import.meta.url).href);
  worker.postMessage({ url: `http://127.0.0.1:${server.port}/?w=${n}`, title: `Spike window ${n}` });
  worker.addEventListener('close', () => {
    log(`window ${n} closed`);
    if (--windows === 0) process.exit(0);
  });
}

function finish() {
  result.rssMb = Math.round(process.memoryUsage().rss / 1e6);
  writeFileSync(resultFile, JSON.stringify(result, null, 2));
  log('selftest done');
  setTimeout(() => process.exit(0), 200);
}

if (selftest) setTimeout(() => { result.timeout = true; finish(); }, 20_000);
log(`server on ${server.port}`);
openWindow();
