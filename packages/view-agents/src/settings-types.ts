/** How a session runs: in a terminal (pty) or in the chat UI. */
export type AgentsMode = 'terminal' | 'chat';

/** The stored Agents settings. */
export interface AgentsSettings {
  /** Mode for new sessions and for opening stopped ones; terminal when omitted. */
  mode?: AgentsMode;
  /** Live ptys + chat processes at which starting a session warns; 12 when omitted. */
  softCap?: number;
  /** Selecting a stopped session resumes it; off (default) shows the stopped-session card instead. */
  resumeOnSelect?: boolean;
  /** Archive stopped sessions idle for 7+ days automatically; on when omitted. */
  autoSettle?: boolean;
  /** Toast when a session needs you / finishes / fails and is not on screen; on when omitted. */
  notifyNeedsYou?: boolean;
  notifyDone?: boolean;
  notifyError?: boolean;
  /** Shell command lines run on a status transition (blank = off). */
  'hooks.onRunning'?: string;
  'hooks.onWaiting'?: string;
  'hooks.onDone'?: string;
  'hooks.onError'?: string;
  /** Claude executable; blank or omitted = detect (`claude.exe`, the npm shim's native binary, the shim). */
  claudeCommand?: string;
  /** Extra arguments appended after the ones the view passes to `claude`. */
  claudeArgs?: string[];
}
