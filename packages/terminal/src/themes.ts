import type { ITheme } from '@xterm/xterm';
import { schemeTheme, type ColorScheme } from './schemes.ts';
import { xtermTheme } from './theme.ts';

export const TERMINAL_THEMES = ['app', 'dark-plus', 'light-plus', 'solarized-dark', 'solarized-light', 'dracula', 'one-dark', 'nord', 'gruvbox-dark', 'monokai'] as const;
export type TerminalThemeId = (typeof TERMINAL_THEMES)[number];

/** Background, foreground, cursor, selection, then the 16 ANSI colors (black..white, bright black..bright white). */
type Palette = [string, string, string, string, ...string[]];

const ANSI: (keyof ITheme)[] = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

const PALETTES: Record<Exclude<TerminalThemeId, 'app'>, Palette> = {
  'dark-plus': ['#1e1e1e', '#cccccc', '#aeafad', '#264f78', '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5', '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#e5e5e5'],
  'light-plus': ['#ffffff', '#333333', '#000000', '#add6ff', '#000000', '#cd3131', '#00bc00', '#949800', '#0451a5', '#bc05bc', '#0598bc', '#555555', '#666666', '#cd3131', '#14ce14', '#b5ba00', '#0451a5', '#bc05bc', '#0598bc', '#a5a5a5'],
  'solarized-dark': ['#002b36', '#839496', '#93a1a1', '#073642', '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#586e75', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
  'solarized-light': ['#fdf6e3', '#657b83', '#586e75', '#eee8d5', '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5', '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
  dracula: ['#282a36', '#f8f8f2', '#f8f8f2', '#44475a', '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2', '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
  'one-dark': ['#282c34', '#abb2bf', '#528bff', '#3e4451', '#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf', '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'],
  nord: ['#2e3440', '#d8dee9', '#d8dee9', '#434c5e', '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0', '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
  'gruvbox-dark': ['#282828', '#ebdbb2', '#ebdbb2', '#504945', '#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984', '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'],
  monokai: ['#272822', '#f8f8f2', '#f8f8f0', '#49483e', '#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2', '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5'],
};

/** `id` when it names a preset or one of `schemes`, else 'app'. */
export function resolveThemeId(id: string | undefined, schemes: readonly ColorScheme[] = []): string {
  if (!id) return 'app';
  if ((TERMINAL_THEMES as readonly string[]).includes(id) || schemes.some((s) => s.id === id)) return id;
  return 'app';
}

/**
 * The xterm theme of a preset or a custom scheme (presets win on a shared id); 'app' (or an unknown
 * id) builds it from the app's CSS tokens through `read`.
 */
export function themeOf(id: string | undefined, read: (token: string) => string, schemes: readonly ColorScheme[] = []): ITheme {
  const palette = id && id !== 'app' && Object.hasOwn(PALETTES, id) ? PALETTES[id as Exclude<TerminalThemeId, 'app'>] : undefined;
  if (!palette) {
    const custom = id && id !== 'app' ? schemes.find((s) => s.id === id) : undefined;
    return custom ? schemeTheme(custom) : xtermTheme(read);
  }
  const [background, foreground, cursor, selectionBackground, ...colors] = palette;
  const theme: Record<string, string> = { background, foreground, cursor, cursorAccent: background, selectionBackground };
  ANSI.forEach((slot, i) => (theme[slot] = colors[i]));
  return theme as ITheme;
}
