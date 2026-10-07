import { app, BrowserWindow, Menu, shell, type BrowserWindowConstructorOptions } from 'electron';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { APP } from '../shared/app.js';
import { createApp } from '../server/http.js';

// `electron . --dev` attaches to `npm run dev:server` + `npm run dev:web` (hot reload).
const DEV_URL = 'http://localhost:5173/?t=dev';
const dev = process.argv.includes('--dev');

let baseUrl = '';

/** Starts the local server on a random loopback port with a fresh session token. */
async function startServer(): Promise<string> {
  if (dev) return DEV_URL;
  const token = randomBytes(24).toString('hex');
  const server = createApp(token);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/?t=${token}`;
}

function windowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 520,
    title: APP.name,
    backgroundColor: '#0d0e11',
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  };
}

function isOwnUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

/** Keeps app pages inside the app; any other http(s) link opens in the default browser. */
function guard(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (isOwnUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: windowOptions() };
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Newer Electron versions put the URL on the event; the second argument is the older form.
  win.webContents.on('will-navigate', (event: { preventDefault(): void; url?: string }, legacyUrl?: string) => {
    const url = event.url ?? legacyUrl ?? '';
    if (isOwnUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  win.webContents.on('did-create-window', (child: BrowserWindow) => guard(child));
}

function createWindow(hash = '') {
  const win = new BrowserWindow(windowOptions());
  guard(win);
  void win.loadURL(baseUrl + hash);
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP.name,
        submenu: [
          { label: 'New window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
          { type: 'separator' },
          { role: 'reload', accelerator: 'F5' },
          { role: 'toggleDevTools', accelerator: 'F12' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen', accelerator: 'F11' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
      },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) {
  // Launching the app again opens another window of the running instance.
  app.quit();
} else {
  app.on('second-instance', () => createWindow());

  void app.whenReady().then(async () => {
    buildMenu();
    baseUrl = await startServer();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
