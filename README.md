<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/logo-stack-wordmark-dark.svg">
    <img src="docs/logo/logo-stack-wordmark-light.svg" alt="DeckBuilder" width="352">
  </picture>
</p>

Base for local-first desktop apps. A Bun workspace of shared packages plus thin apps on top; each app builds to one self-contained executable. The gallery app is the example, and it shows every view below.

![Home, dark](docs/home-dark.png)

## Install

Requirements: [Bun](https://bun.sh) 1.3 or newer (not needed for the gallery executable). Window mode needs the OS web view: WebView2 on Windows 10/11, WebKitGTK 6.0 on Linux (`sudo apt install libwebkitgtk-6.0-4` on Debian/Ubuntu).

There are five ways to install or run it:

| Way | Needs Bun | For |
| --- | --- | --- |
| [1. Gallery executable](#1-gallery-executable) | No | Trying the example app |
| [2. Create an app](#2-create-an-app) | Yes | Starting a new app on the published packages |
| [3. Add packages to an existing app](#3-add-packages-to-an-existing-app) | Yes | Using parts of DeckBuilder in your app |
| [4. npm, pnpm or yarn](#4-npm-pnpm-or-yarn) | Yes, to run | Installing with another package manager |
| [5. From source](#5-from-source) | Yes | Running the gallery, building executables, working on the packages |

### 1. Gallery executable

Download the file for your system from the [gallery releases](https://github.com/adrianogpena/deckbuilder/releases?q=gallery-v) and run it:

| System | File |
| --- | --- |
| Windows x64 | `DeckBuilder-<ver>-win-x64.exe` |
| Linux x64, arm64 | `DeckBuilder-<ver>-linux-x64`, `DeckBuilder-<ver>-linux-arm64` |
| macOS Intel, Apple silicon | `DeckBuilder-<ver>-mac-x64`, `DeckBuilder-<ver>-mac-arm64` |

On Linux and macOS, make it executable first (`chmod +x DeckBuilder-*`). The executable opens a native window; `--app` opens an Edge/Chrome app window instead, `--browser` a browser tab, and `--port <n>` sets the port.

### 2. Create an app

```
bunx --package @deckbuilderkit/build deckbuilder new my-app --views explorer,git,rest,terminal,workbench --git
cd my-app
bun install
bun run dev
```

The app starts with Home and Settings. `--views` adds view packages (any of `explorer`, `git`, `rest`, `terminal`, `workbench`), `--name` sets the display name, `--id` the data folder `~/.<id>`, and `--git` runs `git init`. Inside the app, `bun run build` builds its executable and `bunx deckbuilder upgrade` moves every `@deckbuilderkit/*` dependency to the latest version. More in [Using deckbuilder in a new app](CONTRIBUTING.md#using-deckbuilder-in-a-new-app).

### 3. Add packages to an existing app

```
bun add @deckbuilderkit/ui @deckbuilderkit/server-core @deckbuilderkit/view-terminal
```

Packages: `ui`, `server-core`, `server-mods`, `shell`, `platform`, `build`, and the views `view-explorer`, `view-git`, `view-rest`, `view-terminal`, `view-workbench`, all under `@deckbuilderkit/`.

### 4. npm, pnpm or yarn

```
npm install @deckbuilderkit/ui
```

They install the packages, but the packages ship TypeScript source and use Bun APIs, so the app runs on Bun, not Node.

### 5. From source

```
git clone https://github.com/adrianogpena/deckbuilder.git
cd deckbuilder
bun install
bun run dev
```

Open the URL the server prints. From there:

- `bun run build` builds the gallery executable for this machine into `apps/gallery/release/`; `bun run build --target all` builds it for every system.
- `bun packages/build/src/cli.ts new <dir> --local` creates an app linked to the checkout, to try unpublished changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the other scripts.

## Views

- **Home**: your projects and shortcuts.
- **Explorer**: file browser with archives, git badges and file compare.
- **Terminal**: terminal with search and clipboard support.
- **REST**: HTTP client with environments, history, and curl and `.http` import.
- **Workbench**: Oracle client with history, explain plan and table details.
- **Git**: repository status and history.
- **Tabs**: several views side by side in one window.
- **Grid**: views arranged in a grid.
- **Settings**: theme, language, layout and shortcuts.

## Layouts

Eleven layouts change how the app looks and where navigation sits. Details and more screenshots: [docs/LAYOUTS.md](docs/LAYOUTS.md).

<table>
<tr>
<td align="center"><img src="docs/layouts/original/home-dark.webp" width="240" alt="original"><br>original</td>
<td align="center"><img src="docs/layouts/dense/home-dark.webp" width="240" alt="dense"><br>dense</td>
<td align="center"><img src="docs/layouts/calm/home-dark.webp" width="240" alt="calm"><br>calm</td>
<td align="center"><img src="docs/layouts/material/home-dark.webp" width="240" alt="material"><br>material</td>
</tr>
<tr>
<td align="center"><img src="docs/layouts/blueprint/home-dark.webp" width="240" alt="blueprint"><br>blueprint</td>
<td align="center"><img src="docs/layouts/transit/home-dark.webp" width="240" alt="transit"><br>transit</td>
<td align="center"><img src="docs/layouts/islands/home-dark.webp" width="240" alt="islands"><br>islands</td>
<td align="center"><img src="docs/layouts/modeline/home-dark.webp" width="240" alt="modeline"><br>modeline</td>
</tr>
<tr>
<td align="center"><img src="docs/layouts/ribbon/home-dark.webp" width="240" alt="ribbon"><br>ribbon</td>
<td align="center"><img src="docs/layouts/ledger/home-dark.webp" width="240" alt="ledger"><br>ledger</td>
<td align="center"><img src="docs/layouts/atlas/home-dark.webp" width="240" alt="atlas"><br>atlas</td>
<td></td>
</tr>
</table>

Under Settings > Appearance:

- **Dock position**: where the navigation sits.
- **Layout icon**: the icon shown for the layout.
- **Icons**: icon pack (original, material or atom).

## Known limitations

- No cross-platform system tray. The webview-bun shell has none; the tray is implemented for Windows only. See [docs/shell-decision.md](docs/shell-decision.md).

## Links

- [CONTRIBUTING.md](CONTRIBUTING.md): build, test and release.
- [LICENSE.md](LICENSE.md): MIT.
