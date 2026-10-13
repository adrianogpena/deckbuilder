import { createContext, useContext } from 'react';
import type { TerminalOptions } from './xterm-view.ts';

/** App-wide terminal preferences; a pane's own `options` prop wins. */
export const TerminalOptionsContext = createContext<TerminalOptions | undefined>(undefined);

export const useTerminalOptions = (): TerminalOptions | undefined => useContext(TerminalOptionsContext);
