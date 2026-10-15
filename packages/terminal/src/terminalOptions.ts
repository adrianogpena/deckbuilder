import { createContext, useContext } from 'react';
import type { TerminalOptions } from './xterm-view.ts';

export { resolveThemeId, TERMINAL_THEMES, themeOf, type TerminalThemeId } from './themes.ts';
export { MAX_SCHEMES, parseWindowsTerminalSchemes, SCHEME_COLORS, type ColorScheme } from './schemes.ts';

/** xterm's default `wordSeparator`. */
export const DEFAULT_WORD_SEPARATORS = ' ()[]{}\',"`';

/** App-wide terminal preferences; a pane's own `options` prop wins. */
export const TerminalOptionsContext = createContext<TerminalOptions | undefined>(undefined);

export const useTerminalOptions = (): TerminalOptions | undefined => useContext(TerminalOptionsContext);
