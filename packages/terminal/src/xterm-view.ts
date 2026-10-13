import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { readCssToken, xtermTheme } from './theme.ts';
import type { TerminalView } from './view.ts';

/** Look and behavior preferences; a missing field keeps the built-in default. Applied live by `setOptions`. */
export interface TerminalOptions {
  /** Empty follows the `--font-mono` token. */
  fontFamily?: string;
  fontSize?: number;
  cursorStyle?: 'block' | 'bar' | 'underline';
  cursorBlink?: boolean;
  scrollback?: number;
  copyOnSelect?: boolean;
  rightClickPaste?: boolean;
}

export interface XtermViewOptions {
  fontSize?: number;
  options?: TerminalOptions;
  /** A preview: no input, no fitting; it renders at the size `resize` sets. */
  readOnly?: boolean;
  /** Called on every key event before xterm; false means xterm ignores it (it bubbles on). */
  onKey?: (e: KeyboardEvent) => boolean;
}

export interface XtermView extends TerminalView {
  fit(): void;
  focus(): void;
  setTheme(theme: ITheme): void;
  setOptions(options: TerminalOptions): void;
  hasSelection(): boolean;
  getSelection(): string;
  /** The current size in cells. */
  size(): { cols: number; rows: number };
  /** Clears the screen and scrollback before a replay. */
  reset(): void;
  /** The xterm root element, measured to scale a preview. */
  element(): HTMLElement;
}

const tokenTheme = () => xtermTheme(readCssToken());

export function createXtermView(el: HTMLElement, opts: XtermViewOptions = {}): XtermView {
  const term = new Terminal({
    allowProposedApi: true, // the unicode addon's `unicode.activeVersion`
    fontFamily: readCssToken()('--font-mono').trim() || 'monospace',
    fontSize: opts.fontSize ?? 13,
    disableStdin: !!opts.readOnly,
    cursorBlink: !opts.readOnly,
    scrollback: 5000,
    theme: tokenTheme(),
    linkHandler: { activate: (_e, uri) => window.open(uri, '_blank', 'noopener'), allowNonHttpProtocols: false },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, '_blank', 'noopener')));
  if (opts.onKey) term.attachCustomKeyEventHandler(opts.onKey);
  term.open(el);

  const fit = () => {
    if (opts.readOnly || !el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return;
    try {
      fitAddon.fit();
    } catch {
      // not rendered yet
    }
  };
  const resizeObserver = new ResizeObserver(() => fit());
  resizeObserver.observe(el);
  // Palette switches change the tokens on <html>.
  const themeObserver = new MutationObserver(() => {
    term.options.theme = tokenTheme();
  });
  themeObserver.observe(document.documentElement, { attributes: true });

  let copyOnSelect = false;
  let rightClickPaste = false;
  const setOptions = (o: TerminalOptions) => {
    term.options.fontFamily = o.fontFamily?.trim() || readCssToken()('--font-mono').trim() || 'monospace';
    term.options.fontSize = o.fontSize ?? opts.fontSize ?? 13;
    term.options.cursorStyle = o.cursorStyle ?? 'block';
    term.options.cursorBlink = (o.cursorBlink ?? true) && !opts.readOnly;
    term.options.scrollback = o.scrollback ?? 5000;
    copyOnSelect = !!o.copyOnSelect;
    rightClickPaste = !!o.rightClickPaste;
    fit();
  };
  if (opts.options) setOptions(opts.options);

  const subs: { dispose(): void }[] = [];
  if (!opts.readOnly) {
    subs.push(
      term.onSelectionChange(() => {
        if (copyOnSelect && term.hasSelection()) void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
      }),
    );
    const onContextMenu = (e: MouseEvent) => {
      if (!rightClickPaste) return;
      e.preventDefault();
      void navigator.clipboard?.readText().then((text) => text && term.paste(text), () => {});
    };
    el.addEventListener('contextmenu', onContextMenu);
    subs.push({ dispose: () => el.removeEventListener('contextmenu', onContextMenu) });
  }
  return {
    write: (data) => term.write(data),
    resize: (cols, rows) => {
      if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
    },
    onInput: (cb) => void subs.push(term.onData(cb)),
    onResize: (cb) => void subs.push(term.onResize(({ cols, rows }) => cb(cols, rows))),
    fit,
    focus: () => term.focus(),
    setTheme: (theme) => {
      term.options.theme = theme;
    },
    setOptions,
    hasSelection: () => term.hasSelection(),
    getSelection: () => term.getSelection(),
    size: () => ({ cols: term.cols, rows: term.rows }),
    reset: () => term.reset(),
    element: () => term.element ?? el,
    dispose: () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      for (const s of subs) s.dispose();
      term.dispose();
    },
  };
}
