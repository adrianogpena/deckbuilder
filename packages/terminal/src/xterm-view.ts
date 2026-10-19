import { ClipboardAddon } from '@xterm/addon-clipboard';
import { FitAddon } from '@xterm/addon-fit';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal, type FontWeight, type IDecoration, type IMarker, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { t } from '@deckbuilderkit/ui';
import { trimCopied, type PasteWarning } from './paste.ts';
import type { ColorScheme } from './schemes.ts';
import { parseOsc133, parseOsc7 } from './shell-integration.ts';
import { DEFAULT_WORD_SEPARATORS } from './terminalOptions.ts';
import { readCssToken } from './theme.ts';
import { themeOf } from './themes.ts';
import type { TerminalView } from './view.ts';

export type TerminalFontWeight = 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

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
  lineHeight?: number;
  letterSpacing?: number;
  fontWeight?: TerminalFontWeight;
  fontWeightBold?: TerminalFontWeight;
  /** A preset of `themes.ts`; 'app' follows the app palette. */
  theme?: string;
  minimumContrastRatio?: number;
  /** Joins pairs like `->` through the ligatures addon on the WebGL renderer; with the DOM renderer (GPU off or failed) only CSS ligatures apply. */
  ligatures?: boolean;
  gpuAcceleration?: 'auto' | 'on' | 'off';
  /** What a bell does in the pane: 'sound'/'both' beep (the tab marker is the app's). */
  bellStyle?: 'tab' | 'sound' | 'both' | 'none';
  wordSeparators?: string;
  scrollSensitivity?: number;
  fastScrollSensitivity?: number;
  altIsMeta?: boolean;
  /** Gutter dots at commands reported by shell integration (OSC 133). */
  commandDecorations?: boolean;
  /** Custom color schemes `theme` may name. */
  schemes?: ColorScheme[];
  /** Space around the text in pixels (0 to 48, default 8). */
  padding?: number;
  scrollbar?: 'visible' | 'hover' | 'hidden';
  /** Percent a pane without the focus is dimmed in a split (0 to 80); applied by the pane. */
  dimUnfocused?: number;
  /** When a paste asks first; applied by the pane. */
  pasteWarning?: PasteWarning;
  /** Characters from which a paste counts as large. */
  pasteLargeSize?: number;
  /** Copied lines lose their trailing spaces (default true). */
  trimCopy?: boolean;
}


export interface XtermViewOptions {
  fontSize?: number;
  options?: TerminalOptions;
  /** A preview: no input, no fitting; it renders at the size `resize` sets. */
  readOnly?: boolean;
  /** Called on every key event before xterm; false means xterm ignores it (it bubbles on). */
  onKey?: (e: KeyboardEvent) => boolean;
  /** The shell reported its folder (OSC 7). */
  onCwd?: (cwd: string) => void;
  onBell?: () => void;
  /** Shell integration: a command started (true) or finished (false, with its exit code). */
  onCommand?: (running: boolean, code?: number | null) => void;
  /** Called on every paste (keyboard, right-click); true means it took the text and xterm does not paste it. */
  onPaste?: (text: string) => boolean;
}

export type ScrollKind = 'lineUp' | 'lineDown' | 'pageUp' | 'pageDown' | 'top' | 'bottom';

/** A prompt reported by OSC 133, and the gutter dot of its command. */
interface Prompt {
  marker: IMarker;
  started: boolean;
  done: boolean;
  code: number | null;
  deco?: IDecoration;
  el?: HTMLElement;
}

export interface FindOptions {
  caseSensitive?: boolean;
  regex?: boolean;
}

/** Match highlights; the addon only takes #RRGGBB. */
const FIND_DECORATIONS = {
  matchBackground: '#5a4fa0',
  matchBorder: '#5a4fa0',
  matchOverviewRuler: '#9b8cff',
  activeMatchBackground: '#c9a227',
  activeMatchBorder: '#e6c34a',
  activeMatchColorOverviewRuler: '#e6c34a',
};

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
  /** Selects and scrolls to the next (or previous) match of `term`; false when none. */
  findNext(term: string, o?: FindOptions): boolean;
  findPrevious(term: string, o?: FindOptions): boolean;
  /** Reports the active match index (-1 when none) and the count after each search or output. */
  onFindResults(cb: (index: number, count: number) => void): void;
  /** Removes the highlights and the match selection. */
  clearFind(): void;
  /** Scrolls to the previous (-1) or next (1) prompt that shell integration marked; false when none. */
  scrollToPrompt(dir: 1 | -1): boolean;
  /** Pastes `text` as typed by the user (bracketed when the program asked for it). */
  paste(text: string): void;
  /** The program turned bracketed paste mode on. */
  bracketedPaste(): boolean;
  /** Clears the screen and scrollback, keeping the prompt line. */
  clear(): void;
  scroll(kind: ScrollKind): void;
  /** The xterm root element, measured to scale a preview. */
  element(): HTMLElement;
}

/** Opens http(s) links in the browser; any other scheme (OSC 8 included) is ignored. */
function openLink(uri: string) {
  if (/^https?:\/\//i.test(uri)) window.open(uri, '_blank', 'noopener');
}

// Used when the font's own ligature table can't be read (no local font access in the webview).
const LIGATURE_FALLBACK = [
  '<--', '<---', '<<-', '<-', '->', '->>', '-->', '--->', '<==', '<===', '<<=', '<=', '=>', '=>>', '==>', '===>', '>=', '>>=',
  '<->', '<-->', '<--->', '<---->', '<=>', '<==>', '<===>', '<====>', '::', ':::', '<~~', '</', '</>', '/>', '~~>', '==', '!=',
  '/=', '~=', '<>', '===', '!==', '!===', '<:', ':=', '*=', '*+', '<*', '<*>', '*>', '<|', '<|>', '|>', '+*', '=*', '=:', ':>',
  '/*', '*/', '+++', '<!--', '<!---', '|-', '-|', '||', '&&', '..', '...', '++', '--', '##', '###', '####', '>>', '<<', '>>>', '<<<',
];

export function createXtermView(el: HTMLElement, opts: XtermViewOptions = {}): XtermView {
  let themeId = 'app';
  let schemes: ColorScheme[] | undefined;
  const tokenTheme = () => {
    const theme = themeOf(themeId, readCssToken(), schemes);
    if (theme.background) el.style.setProperty('--terminal-bg', theme.background);
    else el.style.removeProperty('--terminal-bg');
    return theme;
  };
  const term = new Terminal({
    allowProposedApi: true, // the unicode addon's `unicode.activeVersion`
    fontFamily: readCssToken()('--font-mono').trim() || 'monospace',
    fontSize: opts.fontSize ?? 13,
    disableStdin: !!opts.readOnly,
    cursorBlink: !opts.readOnly,
    scrollback: 5000,
    theme: tokenTheme(),
    linkHandler: { activate: (_e, uri) => openLink(uri), allowNonHttpProtocols: false },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(new WebLinksAddon((_e, uri) => openLink(uri)));
  if (!opts.readOnly) {
    // OSC 52: programs may write the clipboard, never read it.
    term.loadAddon(
      new ClipboardAddon(undefined, {
        readText: (_selection: string) => '',
        writeText: async (_selection: string, text: string) => {
          await navigator.clipboard?.writeText(text).catch(() => {});
        },
      }),
    );
  }
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

  // WebGL renderer: 'auto' gives up for good after a failure or a lost context; 'on' tries again on the next options change.
  let webgl: WebglAddon | null = null;
  let webglFailed = false;
  const dropWebgl = () => {
    webgl?.dispose();
    webgl = null;
  };
  const setRenderer = (mode: 'auto' | 'on' | 'off') => {
    // The ligatures addon joins glyphs through the WebGL renderer; the DOM renderer's letter-spacing blocks CSS ligatures.
    const want = mode === 'on' || (mode === 'auto' && !webglFailed);
    if (!want) return dropWebgl();
    if (webgl) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        webglFailed = true;
        dropWebgl();
      });
      term.loadAddon(addon);
      webgl = addon;
    } catch {
      webglFailed = true;
      webgl = null;
    }
  };

  let ligaturesAddon: LigaturesAddon | null = null;
  const setLigatures = (on: boolean) => {
    if (!on) {
      ligaturesAddon?.dispose();
      ligaturesAddon = null;
      return;
    }
    if (ligaturesAddon) return;
    ligaturesAddon = new LigaturesAddon({ fallbackLigatures: LIGATURE_FALLBACK });
    term.loadAddon(ligaturesAddon);
  };

  // Shell integration (OSC 133): a marker per prompt, a gutter dot per command.
  const prompts: Prompt[] = [];
  let decorate = false;
  const paint = (p: Prompt) => {
    if (!p.el) return;
    p.el.classList.add('terminal-mark');
    p.el.classList.toggle('running', !p.done);
    p.el.classList.toggle('ok', p.done && p.code === 0);
    p.el.classList.toggle('err', p.done && p.code !== null && p.code !== 0);
    p.el.title = !p.done ? t('terminal.mark.running') : p.code === null ? t('terminal.mark.done') : t('terminal.mark.exit', { code: p.code });
  };
  const decorateOne = (p: Prompt) => {
    if (!decorate || p.deco || !p.started || p.marker.isDisposed) return;
    p.deco = term.registerDecoration({ marker: p.marker, x: 0, width: 1 });
    p.deco?.onRender((elem) => {
      p.el = elem;
      paint(p);
    });
  };
  const setDecorations = (on: boolean) => {
    if (on === decorate) return;
    decorate = on;
    for (const p of prompts) {
      if (on) decorateOne(p);
      else {
        p.deco?.dispose();
        p.deco = undefined;
        p.el = undefined;
      }
    }
  };
  const current = (): Prompt => {
    const last = prompts[prompts.length - 1];
    if (last && !last.done && !last.marker.isDisposed) return last;
    const marker = term.registerMarker(0);
    const p: Prompt = { marker, started: false, done: false, code: null };
    if (marker) prompts.push(p);
    return p;
  };
  const oscSubs = [
    term.parser.registerOscHandler(133, (data) => {
      const mark = parseOsc133(data);
      if (!mark) return true;
      if (mark.kind === 'A') {
        const last = prompts[prompts.length - 1];
        if (last && !last.started) {
          last.marker.dispose();
          prompts.pop();
        }
        current();
      } else if (mark.kind === 'C') {
        const p = current();
        p.started = true;
        decorateOne(p);
        opts.onCommand?.(true);
      } else if (mark.kind === 'D') {
        const p = prompts[prompts.length - 1];
        if (p?.started && !p.done) {
          p.done = true;
          p.code = mark.code;
          paint(p);
          opts.onCommand?.(false, mark.code);
        }
      }
      return true;
    }),
    term.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7(data);
      if (cwd) opts.onCwd?.(cwd);
      return false;
    }),
    term.onBell(() => opts.onBell?.()),
  ];
  const scrollToPrompt = (dir: 1 | -1) => {
    const lines = prompts.filter((p) => !p.marker.isDisposed).map((p) => p.marker.line);
    const top = term.buffer.active.viewportY;
    const target = dir < 0 ? [...lines].reverse().find((l) => l < top) : lines.find((l) => l > top);
    if (target === undefined) {
      if (dir > 0) term.scrollToBottom();
      return false;
    }
    term.scrollToLine(target);
    return true;
  };

  let copyOnSelect = false;
  let rightClickPaste = false;
  let trimCopy = true;
  const selection = () => (trimCopy ? trimCopied(term.getSelection()) : term.getSelection());
  const setOptions = (o: TerminalOptions) => {
    term.options.fontFamily = o.fontFamily?.trim() || readCssToken()('--font-mono').trim() || 'monospace';
    term.options.fontSize = o.fontSize ?? opts.fontSize ?? 13;
    term.options.cursorStyle = o.cursorStyle ?? 'block';
    term.options.cursorBlink = (o.cursorBlink ?? true) && !opts.readOnly;
    term.options.scrollback = o.scrollback ?? 5000;
    term.options.lineHeight = o.lineHeight ?? 1;
    term.options.letterSpacing = o.letterSpacing ?? 0;
    term.options.fontWeight = (o.fontWeight ?? 'normal') as FontWeight;
    term.options.fontWeightBold = (o.fontWeightBold ?? 'bold') as FontWeight;
    term.options.minimumContrastRatio = o.minimumContrastRatio ?? 1;
    term.options.wordSeparator = o.wordSeparators ?? DEFAULT_WORD_SEPARATORS;
    term.options.scrollSensitivity = o.scrollSensitivity ?? 1;
    term.options.fastScrollSensitivity = o.fastScrollSensitivity ?? 5;
    term.options.macOptionIsMeta = !!o.altIsMeta;
    if ((o.theme ?? 'app') !== themeId || o.schemes !== schemes) {
      themeId = o.theme ?? 'app';
      schemes = o.schemes;
      term.options.theme = tokenTheme();
    }
    if (!opts.readOnly) el.style.setProperty('--terminal-padding', `${Math.max(0, Math.min(48, o.padding ?? 8))}px`);
    el.classList.toggle('scrollbar-hover', o.scrollbar === 'hover');
    el.classList.toggle('scrollbar-hidden', o.scrollbar === 'hidden');
    trimCopy = o.trimCopy ?? true;
    el.classList.toggle('ligatures', !!o.ligatures);
    setRenderer(o.gpuAcceleration ?? 'auto');
    setLigatures(!!o.ligatures);
    setDecorations(o.commandDecorations ?? true);
    copyOnSelect = !!o.copyOnSelect;
    rightClickPaste = !!o.rightClickPaste;
    fit();
  };
  if (opts.options) setOptions(opts.options);
  else {
    setRenderer('auto');
    setDecorations(true);
  }

  const subs: { dispose(): void }[] = [...oscSubs];
  if (!opts.readOnly) {
    subs.push(
      term.onSelectionChange(() => {
        if (copyOnSelect && term.hasSelection()) void navigator.clipboard?.writeText(selection()).catch(() => {});
      }),
    );
    const onContextMenu = (e: MouseEvent) => {
      if (!rightClickPaste) return;
      e.preventDefault();
      void navigator.clipboard?.readText().then((text) => text && !opts.onPaste?.(text) && term.paste(text), () => {});
    };
    el.addEventListener('contextmenu', onContextMenu);
    // Capture: before xterm's own paste handler on its textarea.
    const onPasteEvent = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text || !opts.onPaste?.(text)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    el.addEventListener('paste', onPasteEvent, true);
    subs.push({
      dispose: () => {
        el.removeEventListener('contextmenu', onContextMenu);
        el.removeEventListener('paste', onPasteEvent, true);
      },
    });
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
    getSelection: selection,
    size: () => ({ cols: term.cols, rows: term.rows }),
    reset: () => {
      for (const p of prompts.splice(0)) {
        p.deco?.dispose();
        p.marker.dispose();
      }
      term.reset();
    },
    scrollToPrompt,
    paste: (text) => term.paste(text),
    bracketedPaste: () => term.modes.bracketedPasteMode,
    clear: () => term.clear(),
    scroll: (kind) => {
      if (kind === 'lineUp' || kind === 'lineDown') term.scrollLines(kind === 'lineUp' ? -1 : 1);
      else if (kind === 'pageUp' || kind === 'pageDown') term.scrollPages(kind === 'pageUp' ? -1 : 1);
      else if (kind === 'top') term.scrollToTop();
      else term.scrollToBottom();
    },
    findNext: (q, o) => searchAddon.findNext(q, { ...o, decorations: FIND_DECORATIONS }),
    findPrevious: (q, o) => searchAddon.findPrevious(q, { ...o, decorations: FIND_DECORATIONS }),
    onFindResults: (cb) => void subs.push(searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => cb(resultIndex, resultCount))),
    clearFind: () => searchAddon.clearDecorations(),
    element: () => term.element ?? el,
    dispose: () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      for (const s of subs) s.dispose();
      dropWebgl();
      term.dispose();
    },
  };
}
