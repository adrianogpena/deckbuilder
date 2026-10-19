/** How a session runs: in a terminal (pty) or in the chat UI. */
export type AgentsMode = 'terminal' | 'chat';

/** Session restore after a restart: ask (banner), resume silently, or skip. */
export type AgentsRestore = 'ask' | 'always' | 'never';

/** Where the sidebar usage section sits. */
export type AgentsUsagePosition = 'float' | 'top' | 'bottom';

/** The stored Agents settings. */
export interface AgentsSettings {
  /** Mode for new sessions and for opening stopped ones; terminal when omitted. */
  mode?: AgentsMode;
  /** What to do with the sessions the previous run left live; ask when omitted. */
  restoreSessions?: AgentsRestore;
  /** Live ptys + chat processes at which starting a session warns; 12 when omitted. */
  softCap?: number;
  /** Selecting a stopped session resumes it; off (default) shows the stopped-session card instead. */
  resumeOnSelect?: boolean;
  /** Sessions kept per project (live ones always count first); 10 when omitted. */
  maxSessionsPerProject?: number;
  /** Days a deleted session stays in the trash before startup removes it; 30 when omitted. */
  trashRetentionDays?: number;
  /** Archive stopped sessions idle for 7+ days automatically; on when omitted. */
  autoSettle?: boolean;
  /** Background git status of every listed session's cwd; on when omitted, false = git never runs. */
  gitStatus?: boolean;
  /** Toast when a session needs you / finishes / fails and is not on screen; on when omitted. */
  notifyNeedsYou?: boolean;
  notifyDone?: boolean;
  notifyError?: boolean;
  /** Do not disturb: no toast while on (alerts and hooks still run); off when omitted. */
  doNotDisturb?: boolean;
  /** Shell command lines run on a status transition (blank = off). */
  'hooks.onRunning'?: string;
  'hooks.onWaiting'?: string;
  'hooks.onDone'?: string;
  'hooks.onError'?: string;
  /** Usage section for the selected Claude session + context % on running rows; off when omitted. */
  'usage.show'?: boolean;
  /** Where the usage section sits: right after the last row (float, default), or pinned top / bottom. */
  'usage.position'?: AgentsUsagePosition;
  /** One line ('ctx 42% · 5h 73% · 7d 12%') instead of the full layout; off when omitted. */
  'usage.compact'?: boolean;
  /** Reset times as 20:30 instead of 8:30 PM; off when omitted. */
  'usage.use24HourClock'?: boolean;
  /** Per-row visibility of the full layout; each on when omitted. */
  'usage.showAccount'?: boolean;
  'usage.showModel'?: boolean;
  'usage.showCache'?: boolean;
  'usage.showContext'?: boolean;
  'usage.showFiveHour'?: boolean;
  'usage.showSevenDay'?: boolean;
  /** Config dir of the account new sessions launch as; blank or omitted = the default account. */
  'accounts.activeAccount'?: string;
  /** Show sessions of every account; on when omitted, off hides other accounts' Claude sessions. */
  'accounts.showAllSessions'?: boolean;
  /** One project node per project; on when omitted, off = one node per (project, account). */
  'accounts.shareProjects'?: boolean;
  /** With several accounts, show the owner (email before `@`) of sessions not owned by the active account; off when omitted. */
  'accounts.showOwner'?: boolean;
  /** Claude executable; blank or omitted = detect (`claude.exe`, the npm shim's native binary, the shim). */
  claudeCommand?: string;
  /** Extra arguments appended after the ones the view passes to `claude`. */
  claudeArgs?: string[];
}
