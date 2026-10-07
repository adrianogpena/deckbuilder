# Deckbase

Starter for local-first desktop apps. Copy it to begin a new project.

- **Electron shell** (`desktop/main.ts`) starts the local HTTP server in-process on a random
  `127.0.0.1` port and opens the UI in a window.
- **Local Node server** (`server/`) serves the built UI and a small JSON API. Every API call
  needs a per-session token, and only loopback host names are accepted (blocks DNS rebinding).
- **Web UI** (`web/`, React + Vite): sidebar layout, dark/light theme, English/Portuguese,
  error banners, cards, tables, modals. Uses the Geist fonts and one set of color tokens.
- The same app also runs **in the browser** (`npm start`), with no Electron involved.
- Settings are saved to `~/.deckbase/settings.json`, outside the install folder, so they
  survive reinstalls.

## Requirements

Node 20 or newer (CI uses 22). `npm install` once. The Electron binary downloads on the first
`electron` run.

## Scripts

| Command | What it does |
|---|---|
| `npm run desktop` | Build everything and open the desktop app. |
| `npm start` | Run in browser mode: serves the built UI and opens the default browser. `--port <n>`, `--no-open`. Needs `npm run build` first. |
| `npm run dev:server` + `npm run dev:web` | Hot reload. The server listens on port 7420 with token `dev`; open `http://localhost:5173/?t=dev`. |
| `npm run dev:desktop` | Desktop window on top of the two dev servers above. |
| `npm run typecheck` | Type-checks the server and the UI. |
| `npm run build` | Compiles `server/`, `desktop/` and `shared/` to `dist/`, and bundles `web/` to `dist/web`. |
| `npm run icon` | Renders `build/icon.svg` to `build/icon.png` (1024 px) and copies it to the favicon. |
| `npm run dist:win` | Windows installer + portable exe in `release/`. |
| `npm run dist:mac` | macOS `.dmg` + `.zip` in `release/` (run on a Mac). |
| `npm run dist:linux` | Linux `.AppImage` + `.deb` in `release/` (run on Linux or WSL). |

## Layout

```
shared/app.ts        App name and id, used by server, desktop shell and UI
desktop/main.ts      Electron main process: server, windows, menu, single-instance lock
server/cli.ts        Browser mode entry (bin/deckbase.js)
server/http.ts       HTTP server: host check, token check, static files, error handling
server/routes.ts     The API: add endpoints here
server/errors.ts     AppError: kind -> HTTP status, translatable code
server/settings.ts   ~/.deckbase/settings.json
web/src/App.tsx      Shell: loads settings, sidebar navigation, screen switch
web/src/route.ts     Hash routes (#/home, #/settings)
web/src/screens/     One file per screen
web/src/components/  Sidebar and shared UI (Badge, Spinner, ErrorBanner, Modal, Icon, ...)
web/src/i18n/        en.ts (source of keys) and pt-BR.ts
web/src/styles.css   Color tokens for both themes, then component styles
build/icon.svg       App icon source (build/icon.png is generated from it)
```

### Adding things

- **An endpoint**: add `'GET /api/thing': async (q) => ...` to `server/routes.ts`, then a
  method in `api` in `web/src/api.ts`. Throw `invalid(...)`/`notFound(...)` from
  `server/errors.ts` for errors the UI should show; add `error.<code>` to the i18n files to
  translate them.
- **A screen**: add its id to `SCREENS` in `web/src/route.ts`, a file in `web/src/screens/`,
  an entry in `NAV` and a case in `renderScreen` in `web/src/App.tsx`, and its labels to
  `web/src/i18n/en.ts` and `pt-BR.ts` (TypeScript fails until both have every key).
- **A setting**: extend `Settings` in `server/settings.ts` (and validate it in
  `saveSettings`) and in `web/src/api.ts`.

## Starting a new project from this one

1. Copy the folder without `node_modules`, `dist`, `release` and `.git`, then `git init`.
2. Rename:
   - `shared/app.ts`: `name` and `id`.
   - `package.json`: `name`, `productName`, `description`, `bin` (and rename
     `bin/deckbase.js`), the `start` script, `build.appId` (reverse-DNS, unique per app),
     `build.productName`.
   - `web/index.html`: `<title>`.
   - `desktop/main.ts`: `backgroundColor` if you change the theme.
3. Replace `build/icon.svg` and run `npm run icon`. Update `BrandMark` in
   `web/src/components/ui.tsx` to match.
4. Change the accent color: `--accent`, `--accent-2`, `--accent-soft` and `--ink-on-accent`
   in `web/src/styles.css` (both themes).
5. Delete the example `POST /api/echo` endpoint and the `EchoCard` on the home screen.

## Releases

The version comes from `version` in `package.json`; installers are named
`Deckbase-<version>-<os>-<arch>.<ext>`. Bump it before building a release:

```sh
npm version patch      # or minor / major: edits package.json, commits, and tags v0.1.1
```

electron-builder only builds reliably for the OS it runs on. Build each platform on that
platform, or let GitHub Actions build all three (see "Release through GitHub Actions").

### Windows

```sh
npm run dist:win
```

Produces in `release/`:

- `Deckbase-<ver>-win-x64.exe`: NSIS installer. Installs per user to
  `%LOCALAPPDATA%\Programs\Deckbase`, lets the user pick the folder, and adds Start menu and
  desktop shortcuts. Silent install: run it with `/S`.
- `Deckbase-<ver>-win-x64-portable.exe`: single exe, no install.
- `win-unpacked/`: the unpacked app, handy for quick testing.

Notes:

- The build fails if `release/win-unpacked/Deckbase.exe` is running (file lock). Quit the
  app first.
- The app holds a single-instance lock. Starting a new build while an old one runs only opens
  a window in the old process; quit every window before testing a new build.
- Without a code-signing certificate, SmartScreen warns on first run ("More info" -> "Run
  anyway"). To sign, set `CSC_LINK` (path or base64 of a `.pfx`) and `CSC_KEY_PASSWORD`
  before building.

### macOS

Must run on a Mac (Xcode command line tools: `xcode-select --install`).

```sh
npm ci
npm run dist:mac                         # architecture of this Mac
npx electron-builder --mac --universal   # one app for Intel and Apple silicon (after npm run build)
```

Produces `Deckbase-<ver>-mac-<arch>.dmg` (drag-to-Applications installer) and `.zip` (used by
auto-update, also fine for manual download). electron-builder builds the `.icns` icon from
`build/icon.png`.

**Unsigned builds** work on your own Mac. When the app is downloaded on another Mac,
Gatekeeper blocks it ("app is damaged" or "unidentified developer"). The user can run:

```sh
xattr -dr com.apple.quarantine /Applications/Deckbase.app
```

or right-click the app, choose Open, then confirm.

**Signed and notarized builds** (no warnings) need a paid Apple Developer account:

1. Create a "Developer ID Application" certificate and export it with its key as a `.p12`.
2. Create an app-specific password at appleid.apple.com.
3. Add `"notarize": true` to `build.mac` in `package.json`.
4. Build with these environment variables:

   ```sh
   export CSC_LINK=/path/to/cert.p12        # or base64 of the file
   export CSC_KEY_PASSWORD=...
   export APPLE_ID=you@example.com
   export APPLE_APP_SPECIFIC_PASSWORD=...
   export APPLE_TEAM_ID=XXXXXXXXXX
   npm run dist:mac
   ```

### Linux

Run on Linux, or on Windows inside WSL (Ubuntu). electron-builder downloads the tools it
needs for AppImage and `.deb` (`fpm`) by itself. An `rpm` target also needs
`sudo apt install rpm`.

```sh
npm ci              # inside Linux: the Windows node_modules won't work
npm run dist:linux
```

In WSL, clone or copy the project into the Linux file system (`~/src/...`), not
`/mnt/c/...`: the Windows `node_modules` has Windows binaries, and builds under `/mnt/c` are
slow.

Produces:

- `Deckbase-<ver>-linux-x86_64.AppImage`: runs on most distributions.
  `chmod +x Deckbase-*.AppImage && ./Deckbase-*.AppImage`. Some distributions need `libfuse2`
  (`sudo apt install libfuse2`).
- `Deckbase-<ver>-linux-amd64.deb`: `sudo apt install ./Deckbase-*.deb`. The package
  maintainer comes from `build.linux.maintainer` in `package.json`.

For ARM (Raspberry Pi and similar) add `--arm64`: `npx electron-builder --linux --arm64`.
Other targets (`rpm`, `snap`, `flatpak`, `tar.gz`) go in `build.linux.target`.

### Release through GitHub Actions

`.github/workflows/release.yml` builds Windows, macOS and Linux in parallel when a tag
`v*` is pushed, and uploads everything to a **draft** GitHub Release.

1. Push the project to a GitHub repository.
2. `npm version patch` (creates the commit and the `v<version>` tag).
3. `git push --follow-tags`.
4. Wait for the "Release" workflow, open the draft release on GitHub, check the files, and
   publish it.

The workflow sets `CSC_IDENTITY_AUTO_DISCOVERY=false`, so builds are unsigned. To sign, add the
variables from the Windows/macOS sections as repository secrets and pass them in the `env` of
the "Package" step. `.github/workflows/ci.yml` type-checks and builds on all three OSes for
every push and pull request.

## Security model

The server binds to `127.0.0.1` only. API calls require the random token generated at start
(passed to the UI in the URL, then kept in `sessionStorage` and sent as the
`x-deckbase-token` header). Requests whose `Host` header is not a loopback name are rejected.
In the desktop app, links to other sites open in the default browser, never inside the app
window. The renderer runs sandboxed, with context isolation and no Node integration.
