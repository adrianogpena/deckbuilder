// Spike: Electrobun shell with the Bun main process. Same self-test as the webview-bun spike:
// local HTTP server, two windows loading it, a tray icon, plus checks of the Bun APIs Dashboard uses.
import { BrowserWindow, Tray } from "electrobun/main";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const selftest = process.env.SPIKE_SELFTEST === "1";
const outDir = join(homedir(), "electrobun-spike");
mkdirSync(outDir, { recursive: true });
const log = (msg: string) => appendFileSync(join(outDir, "spike.log"), `${new Date().toISOString()} ${msg}\n`);
const result: Record<string, unknown> = { shell: "electrobun", bun: typeof Bun !== "undefined" ? Bun.version : null };

try {
	const db = new Database(":memory:");
	result.sqlite = (db.query("select sqlite_version() as v").get() as { v: string }).v;
} catch (e) {
	result.sqlite = `error: ${e}`;
}
try {
	result.spawn = Bun.spawnSync(["cmd", "/c", "echo", "ok"]).stdout.toString().trim();
} catch (e) {
	result.spawn = `error: ${e}`;
}

const html = (n: number) => `<!doctype html><html><head><meta charset="utf-8"><title>Window ${n}</title>
<style>body{background:#0d0e11;color:#eceef2;font:14px system-ui;padding:24px}</style></head>
<body><h1>Electrobun window ${n}</h1>
<button onclick="fetch('/api/new-window',{method:'POST'})">New window</button>
<script>
fetch('/api/report', { method: 'POST', body: JSON.stringify({ ready: ${n}, ua: navigator.userAgent,
  notificationApi: 'Notification' in window, permission: window.Notification?.permission }) });
</script></body></html>`;

let opened = 0;
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === "/api/new-window") {
			openWindow();
			return Response.json({ ok: true });
		}
		if (url.pathname === "/api/report") {
			const body = await req.json();
			result[`window${body.ready}ReadyMs`] = Math.round(process.uptime() * 1000);
			result.userAgent = body.ua;
			result.notification = { hasApi: body.notificationApi, permission: body.permission };
			log(JSON.stringify(body));
			if (body.ready === 1 && selftest) openWindow();
			if (body.ready === 2 && selftest) finish();
			return Response.json({ ok: true });
		}
		return new Response(html(Number(url.searchParams.get("w") ?? 1)), {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	},
});

function openWindow() {
	const n = ++opened;
	new BrowserWindow({
		title: `Spike window ${n}`,
		url: `http://127.0.0.1:${server.port}/?w=${n}`,
		frame: { width: 900, height: 600, x: 100 + n * 40, y: 100 + n * 40 },
	});
}

try {
	const tray = new Tray({ title: "Spike" });
	tray.setMenu([{ type: "normal", label: "Quit", action: "quit" }]);
	tray.on("tray-clicked", (e: any) => e.data?.action === "quit" && process.exit(0));
	result.tray = "created";
} catch (e) {
	result.tray = `error: ${e}`;
}

function finish() {
	result.rssMb = Math.round(process.memoryUsage().rss / 1e6);
	writeFileSync(join(outDir, "spike-result.json"), JSON.stringify(result, null, 2));
	log("selftest done");
	setTimeout(() => process.exit(0), 200);
}

if (selftest) setTimeout(() => { result.timeout = true; finish(); }, 30_000);
log(`server on ${server.port}`);
openWindow();
