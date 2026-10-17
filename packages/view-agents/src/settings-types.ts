/** How a session runs: in a terminal (pty) or in the chat UI. */
export type AgentsMode = 'terminal' | 'chat';

/** The stored Agents settings. */
export interface AgentsSettings {
  /** Mode for new sessions and for opening stopped ones; terminal when omitted. */
  mode?: AgentsMode;
  /** Live ptys + chat processes at which starting a session warns; 12 when omitted. */
  softCap?: number;
  /** Archive stopped sessions idle for 7+ days automatically; on when omitted. */
  autoSettle?: boolean;
  /** Toast when a session needs you / finishes / fails and is not on screen; on when omitted. */
  notifyNeedsYou?: boolean;
  notifyDone?: boolean;
  notifyError?: boolean;
}
