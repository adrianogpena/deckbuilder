# DeckBuilder

Base for local-first desktop apps: a Bun workspace of shared packages plus thin apps on top.
Each app builds to **one self-contained executable** (Bun runtime, server, UI and native window
library inside), and Windows, Linux and macOS executables can all be built from one machine.

- **Server**: `Bun.serve` on `127.0.0.1` with a random port and a per-session token. Serves the
  built UI and a JSON API.
- **Window**: three ways to show the UI. By default a native WebView2 (Windows) / WebKitGTK 6
  (Linux) / WKWebView (macOS) window via [webview-bun](https://github.com/tr1ckydev/webview-bun).
  `--app` opens an Edge/Chrome app window (no tabs or address bar) with its own browser profile
  in `~/.<id>/app-profile`; the app stops when its last app window closes. Without Edge or Chrome
  it falls back to `--browser`, which serves the UI to the default browser.
- **UI**: React + Vite. Sidebar layout, themes (System/Dark/Light and a color palette), English/Portuguese, error banners,
  cards, modals, Geist fonts and one set of color tokens.
- Data and settings live in `~/.<app id>` (here `~/.deckbuilder`), outside the install folder.

The Electron version of this project is in the git history (commit `559a1a5`); see
`spikes/RESULTS.md` for why webview-bun replaced it.

## Requirements

[Bun](https://bun.sh) 1.3 or newer. `bun install` once at the root.

Window mode needs the OS web view: WebView2 is part of Windows 10/11; Linux needs WebKitGTK 6.0
(GTK 4): `sudo apt install libwebkitgtk-6.0-4` on Debian/Ubuntu.

## Scripts

Run at the root (they act on `apps/gallery`) or inside any app folder:

| Command | What it does |
|---|---|
| `bun run dev` | Hot reload: the server in watch mode on port 7420 (token `dev`) plus Vite. Open `http://localhost:5173/?t=dev`. |
| `bun run dev:window` | (in the app folder) The same, with a native window on the Vite URL (`bun run dev -- --app` for an app window). |
| `bun run start` | Run from source in a native window. Needs `build:web` first. `bun run start -- --app` for an app window. |
| `bun run start:browser` | Run from source in browser mode. Flags: `--port <n>`, `--no-open`. |
| `bun run build:web` | Bundle the UI into `apps/<app>/dist/web`. |
| `bun run build` | Build the UI, then the executable for this machine into `apps/<app>/release/`. |
| `bun run build --target all` | Executables for every target. Targets: `windows-x64`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`; comma-separate several. `--no-web` reuses the last UI build. |
| `bun run typecheck` | Type-checks every package and app. |
| `bun test` | (root) Unit tests of the packages. |
| `bun scripts/screenshot.ts --out <png>` | (root) Screenshot of the gallery UI in headless Edge/Chrome, with its own `--dev` server on port 7799 and a temp home. Flags: `--hash <route>`, `--settings '<json>'` (seeds `settings.json`), `--eval '<js>'`, `--size WxH`, `--wait <ms>`, `--no-build`. |
| `bun run deckbuilder release --to <folder>` | (in the app folder) Publish a release for the self-updater, see [Releases](#releases). |
| `bun run deckbuilder manifest` | (in the app folder) Write `release/latest.json` for the built exes, see [Releases](#releases). |

The executable takes the same flags as the source: `--app` (Edge/Chrome app window),
`--browser` (the Settings screen then has a Quit button that stops the app; wins over `--app`),
`--no-open`, `--port <n>`, `--idle-exit <min>` (exit after that
many minutes without a request from an open UI; the UI sends a heartbeat every minute through
`useHeartbeat()`; never with `--dev`), `--help`.

Only one instance runs (except with `--dev`): the running one publishes its port in
`~/.<id>/instance.json`, with a secret that unlocks only `POST /api/instance/open`. A second
launch asks it to open a new window (an app window for `--app`, a browser tab for `--browser`)
and exits. Two launches at
the same moment are kept apart by `~/.<id>/instance.lock` (holds the pid of the launch that
starts the instance).

## Layout

```
packages/
  server-core/   Bun.serve server: host and token checks, static files, AppError, routes type;
                 protocol.ts (token header, dev ports, error body) is shared with the UI
                 release.ts: latest.json manifest and version helpers
  server-mods/   Opt-in route modules: settings (GET/PUT /api/settings), info (GET /api/info),
                 update (self-updater + GET /api/update, POST /api/update/check|apply)
  shell/         runApp(): parses flags, single instance, starts the server, opens a window
                 (one Worker per window, Webview.run() blocks its thread), an app window or
                 the browser
  platform/      OS-specific code: open URL, find Edge/Chrome for app windows, app data folder, error message box, processes
                 (run with timeout, kill tree, start detached), exe swap for updates;
                 win/: toasts, autostart (HKCU Run key), PowerShell runner
  ui/            React components (Sidebar, Badge, ErrorBanner, Modal, Icon, ...), hooks,
                 API client, i18n engine with the base messages, hash routing, styles.css
  build/         The `deckbuilder` CLI used by app scripts: dev, build:web, build, release
apps/
  gallery/       Example app (Home + Settings screens; settings show autostart and updates)
    app.ts         Name and id
    server/        main.ts (composes routes, calls runApp) and routes.ts (the app's own API)
    web/           Vite root: index.html, public/favicon.svg (also the exe icon), src/
spikes/          Shell spike: webview-bun vs Electrobun
scripts/         Root scripts (typecheck)
```

The base imposes no layout: an app picks the components it needs. Packages export TypeScript
source directly; there is no package build step.

### Adding things to an app

- **An endpoint**: add `'GET /api/thing': ({ query, json }) => ...` to `server/routes.ts`, then a
  method in `api` in `web/src/api.ts`. Throw `invalid(...)`/`notFound(...)` from
  `@deckbuilder/server-core` for errors the UI should show; add `error.<code>` to the app's i18n
  files to translate them.
- **A screen**: add its id to `SCREENS` and an entry to `NAV` and `renderScreen` in
  `web/src/App.tsx`, a file in `web/src/screens/`, and its labels to `web/src/i18n/en.ts` and
  `pt-BR.ts` (TypeScript fails until both have every key).
- **A setting**: extend `Settings` in `server/main.ts` and `web/src/api.ts`, give it a default,
  and validate it in the `apply` option of `settingsStore`; react to changes in `onChange`.
- **Themes**: `useTheme(settings)` (from `@deckbuilder/ui`) applies the palette of `ThemeSettings`
  (`theme`, `paletteDark`, `paletteLight`; palettes in `@deckbuilder/server-core/palettes`) to `<html>`.
  Make the app `Settings` extend `ThemeSettings` and render `<AppearanceFields value onChange />` in
  its settings screen. Style with the `var(--…)` tokens only. Pass
  `transformIndex: themeHead(settings)` (from `@deckbuilder/server-mods`) to `runApp`, so
  `index.html` already carries the saved palette and the first paint has its colours.
- **Startup work** (timers, update checks): put it in `runApp`'s `onStart`, which a launch that
  hands off to a running instance never reaches.
- **Notifications** (Windows): `createToaster()` from `@deckbuilder/platform`, then
  `toaster.show({ title, body, launch })`; a click opens `launch`. Use `ctx.link(path)` (the
  context `onStart` gets) as `launch`, so the click opens the app on `#<path>`. Test with
  `bun packages/platform/src/win/toast.ts --selftest`.
- **Deep links** (Windows): `urlProtocol: true` in `runApp` registers `<id>://` for the exe at
  startup (the app id must be a valid URL scheme); `<id>://open/<path>` then opens a native
  window on `#<path>`, through the running instance when there is one. Windows starts the exe
  with `--open-url <uri>`. Remove the registration with
  `reg delete HKCU\Software\Classes\<id> /f`.
- **Tray** (Windows): `tray: true` in `runApp` shows the exe's icon in the notification area
  (a generic icon from source; none with `--dev`), with "Open <name>" (also on double-click)
  and "Quit". Closing the last window then keeps the app running, and it exits when idle only
  with `--idle-exit`. Pass `tray: { openLabel, quitLabel, items: [{ id, label, run }] }` for
  other labels and more entries between those two (ids must not start with `__`). The gallery
  reads it from a setting at startup, so a change takes effect after a restart. Test with
  `bun packages/platform/src/win/tray.ts --selftest`.

## New app

1. Copy `apps/gallery` to `apps/<name>` (without `dist`, `release`, `.build`, `node_modules`).
2. In the copy: `app.ts` (`name`, `id`), `package.json` (`name`, `version`, `description`),
   `web/index.html` (`<title>`).
3. Replace `web/public/favicon.svg`; it is also the exe icon. Update `BrandMark` in
   `packages/ui/src/components/ui.tsx` if the brand should change for every app.
4. Delete the example `POST /api/echo` endpoint and the `EchoCard` on the home screen.
5. `bun install` at the root, then `bun run dev` inside the new folder.

## Releases

The version comes from the app's `package.json`. Executables are named
`<Name>-<version>-<win|linux|mac>-<arch>[.exe]`.

**Locally**: bump `version`, then `bun run build --target all` in the app folder.

**For the self-updater** (a shared folder, e.g. a UNC share): in the app folder,

```sh
bun run deckbuilder release --to '\\server\share\releases' [--bump patch|minor|major] [--target <list>]
```

bumps the version, runs typecheck and tests (`--no-checks` skips them), builds this machine's
exe (or `--target`), copies it with `latest.json` to `<folder>/<app name>/`, then commits the
bump and tags `<app folder>-v<version>` locally; it never pushes. `--dry-run` publishes the
same files but leaves `package.json` and git as they were. Users set the folder (the root or
the `<app name>` subfolder) under Settings › Updates. The app checks at start and every 6 h
(30 min after a failure); applying copies the exe next to the running one, verifies its
SHA-256, renames the running exe to `<name>.old.exe` (Windows allows renaming a running exe,
not replacing it), moves the new one in place, starts it with `--after-update` plus the same
flags, and quits. The new exe deletes the old one once that has exited. The exe keeps its file
name, so the WebView2 profile survives updates.

**Through GitHub Actions**: push a tag `<app folder>-v<version>`, e.g.

```sh
git tag gallery-v0.1.1 && git push origin gallery-v0.1.1
```

`.github/workflows/release.yml` checks the tag against `package.json`, builds every target on
a Windows runner, writes `latest.json` with `deckbuilder manifest` (SHA-256 per exe, notes from
the commits since the previous tag) and uploads everything to a **draft** release; check the
files and publish it.

**GitHub releases as update source**: set `repo: 'owner/name'` in the app's `app.ts`
(`AppIdentity.repo`) and build the app's server with `githubSource({ repo, tagPrefix })` from
`@deckbuilder/server-mods` (the gallery does this when no update folder is set). The updater
takes the newest published release whose tag starts with `<app folder>-v`, reads its
`latest.json` asset and downloads the exe asset; `token` gives access to a private repo.
`deckbuilder manifest` (in the app folder, after `build`) writes `release/latest.json` by hand.
`.github/workflows/ci.yml` type-checks, runs the tests and builds a Linux executable for every
push and pull request.

### Platform notes

- **Windows**: the exe has no console window, so `--browser` mode from the exe runs in the
  background with nothing to close: stop it with the Quit button in Settings, or let it end by
  itself 10 minutes after the last tab closes (idle exit; not when the app has a tray icon,
  whose menu has Quit).
  WebView2 keeps its profile in `%APPDATA%\<exe file name>\`. The webview library passes that
  folder itself, so `WEBVIEW2_USER_DATA_FOLDER` has no effect, and each version (new file
  name) starts with a fresh profile. App state belongs on the server (`~/.<id>`), not in
  `localStorage`. Unsigned executables trigger SmartScreen on first run ("More info" → "Run
  anyway").
- **Linux**: `chmod +x` the file. Window mode needs WebKitGTK (see Requirements).
- **macOS**: the output is a plain executable, not an `.app` bundle, and it is unsigned:
  `xattr -d com.apple.quarantine <file>` after downloading. Not tested on a Mac yet.

## Security model

The server binds to `127.0.0.1` only. API calls require the random token generated at start
(passed to the UI in the URL, then kept in `sessionStorage` and sent as the
`x-deckbuilder-token` header). Requests whose `Host` header is not a loopback name are rejected,
which blocks DNS rebinding. In the native window, links to other origins open in the default
browser, never inside the app window.
