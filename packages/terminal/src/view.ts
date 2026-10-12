/** What `TerminalPane` needs from an emulator; xterm.js implements it (`xterm-view.ts`). */
export interface TerminalView {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onInput(cb: (data: string) => void): void;
  onResize(cb: (cols: number, rows: number) => void): void;
  dispose(): void;
}

// TODO(ghostty-web): not a drop-in as of 0.4.0. It needs 'wasm-unsafe-eval' in the CSP
// (WebAssembly.compile on an inlined data: URL, also fetched, so connect-src data:), an awaited
// init() before `new Terminal`, and ignores `options.theme =` after open() (no live re-theme).
