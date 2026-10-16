<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/logo-stack-wordmark-dark.svg">
    <img src="docs/logo/logo-stack-wordmark-light.svg" alt="DeckBuilder" width="352">
  </picture>
</p>

Base for local-first desktop apps. A Bun workspace of shared packages plus thin apps on top; each app builds to one self-contained executable. The gallery app is the example, and it shows every view below.

![Home, dark](docs/home-dark.png)

## Install

Use the packages in your own app:

```
bun add @deckbuilder/ui @deckbuilder/server-core
```

They ship TypeScript source, so they need Bun. To run the gallery example from source:

- [Bun](https://bun.sh) 1.3 or newer.
- Window mode needs the OS web view: WebView2 on Windows 10/11, WebKitGTK 6.0 on Linux (`sudo apt install libwebkitgtk-6.0-4` on Debian/Ubuntu).

```
bun install
bun run dev
```

Open the URL the server prints. To build the executable, see [CONTRIBUTING.md](CONTRIBUTING.md).

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
