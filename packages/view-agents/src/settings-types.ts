/** How a session runs: in a terminal (pty) or in the chat UI. */
export type AgentsMode = 'terminal' | 'chat';

/** The stored Agents settings. */
export interface AgentsSettings {
  /** Mode for new sessions and for opening stopped ones; terminal when omitted. */
  mode?: AgentsMode;
}
