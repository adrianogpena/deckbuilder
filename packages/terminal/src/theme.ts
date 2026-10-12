import type { ITheme } from '@xterm/xterm';

/** xterm theme slot → app CSS token. Brights reuse the base tokens; the app palette has one shade per hue. */
const SLOTS: [keyof ITheme, string][] = [
  ['background', '--bg-sunken'],
  ['foreground', '--text'],
  ['cursor', '--accent'],
  ['cursorAccent', '--bg-sunken'],
  ['selectionBackground', '--selected'],
  ['black', '--bg-elev'],
  ['red', '--err'],
  ['green', '--ok'],
  ['yellow', '--warn'],
  ['blue', '--info'],
  ['magenta', '--debug'],
  ['cyan', '--y-str'],
  ['white', '--text-2'],
  ['brightBlack', '--text-3'],
  ['brightRed', '--err'],
  ['brightGreen', '--ok'],
  ['brightYellow', '--warn'],
  ['brightBlue', '--info'],
  ['brightMagenta', '--debug'],
  ['brightCyan', '--y-str'],
  ['brightWhite', '--text'],
];

/** Builds an xterm theme from the app's CSS tokens; `read` returns a token's value, empty when unset. */
export function xtermTheme(read: (token: string) => string): ITheme {
  const theme: Record<string, string> = {};
  for (const [slot, token] of SLOTS) {
    const value = read(token).trim();
    if (value) theme[slot] = value;
  }
  return theme as ITheme;
}

/** Reads tokens from the document root's computed style. */
export const readCssToken =
  (el: Element = document.documentElement) =>
  (token: string): string =>
    getComputedStyle(el).getPropertyValue(token);
