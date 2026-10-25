# Shell spike: webview-bun vs Electrobun (2026-10-07, Windows 11 x64)

Both test apps run a local `Bun.serve` server and load it in native WebView2 windows (Edge 154).
Self-test: open window 1, open window 2, probe the web Notification API, record timings.

| Check | webview-bun 2.4.0 | Electrobun 2.0.2 (`mainProcess: "bun"`) |
|---|---|---|
| Built with | `bun build --compile index.ts window.ts` | `hutch run build` (own toolchain, downloads Bun 1.4.0) |
| Output | **one exe, 82 MB**; webview DLL embedded | folder: `launcher.exe` + `bin/bun.exe` + DLLs, 94 MB; 33 MB `.tar.zst` update bundle |
| Installer | none needed (copy and run) | Setup `.zip`, but on Windows it needs VS 2022 C++ Build Tools + cmake. Not installed here, so the stable build exited 0 **without** an installer |
| Cross-build from Windows | yes (`--target`) | no, build on each OS |
| Two windows | yes (one Worker per window, server on main thread) | yes, native API |
| Tray icon | **no** API | yes (`Tray` with menu) |
| Web notifications | API present, permission **denied** (no handler) | API present, permission `default` (not requested) |
| Native toasts | reuse Dashboard's PowerShell/WinRT `win/toast.ts` (shell-independent) | same |
| `bun:sqlite`, `Bun.spawn`, `Bun.serve` | yes (the app *is* Bun) | yes (Bun main process) |
| Start → window 1 ready | 0.6–0.8 s warm, 2.9 s first run | 1.5 s (dev build) |
| RAM (server process) | 62 MB | 70 MB |
| Console window | hidden with `--windows-hide-console` | none |
| WebView2 data folder | `%APPDATA%\<exe name>\`, passed by the webview library; `WEBVIEW2_USER_DATA_FOLDER` has no effect (checked later) | `%LOCALAPPDATA%\<identifier>\` |
| Updates | none in the app: users download a new exe from GitHub releases (the `latest.json` updater was removed) | built-in, with binary delta patches (needs `release.baseUrl`) |
| Setup weight | one npm package | Hutch toolchain: 286 MB in `~/.hutch`, adds itself to the user PATH. The installer breaks under Git Bash (GNU tar); run it from PowerShell |
| Maturity / churn | small binding over the stable `webview` C library | v2 moved the SDK off npm to Hutch; default runtime is now "Cottontail", not Bun |

## Verdict

**webview-bun** for the base. It keeps Dashboard's model (one exe, cross-build) and
covers multiple windows. The known gap is the **tray icon**, which only matters for background
apps like Dashboard. Options there: a small tray helper (PowerShell `NotifyIcon` or a tiny native
exe), or keep such apps in browser mode.

Revisit **Electrobun** if an app needs tray, native menus and installers together, and only after
installing the VS Build Tools to verify the Windows installer. Its v2 toolchain churn is the main risk.

## Reproduce

- webview-bun: `cd spikes/webview-bun && bun install && bun build index.ts window.ts --compile --minify --windows-hide-console --outfile dist/spike.exe && dist/spike.exe --selftest` → `dist/spike-result.json`.
- Electrobun (PowerShell, Hutch installed): `cd spikes/electrobun/app; $env:SPIKE_SELFTEST=1; hutch run start` → `~/electrobun-spike/spike-result.json`.

Update: the tray gap is closed (`packages/platform/src/win/tray.ts`).
