/** How a session runs: in a terminal (pty) or in the chat UI. */

/** Session restore after a restart: ask (banner), resume silently, or skip. */
export type AgentsRestore = 'ask' | 'always' | 'never';

/** Where the sidebar usage section sits. */
export type AgentsUsagePosition = 'top' | 'bottom';

/** The stored Agents settings. */
export interface AgentsSettings {
  /** What to do with the sessions the previous run left live; ask when omitted. */
  restoreSessions?: AgentsRestore;
  /** Live ptys at which starting a session warns; 12 when omitted. */
  softCap?: number;
  /** Selecting a stopped session resumes it; off (default) shows the stopped-session card instead. */
  resumeOnSelect?: boolean;
  /** Sessions kept per project (live ones always count first); 10 when omitted. */
  maxSessionsPerProject?: number;
  /** Sessions the project summary lists; omitted = follows `maxSessionsPerProject`. */
  maxSessionsOnSummary?: number;
  /** Days a deleted session stays in the trash before startup removes it; 30 when omitted. */
  trashRetentionDays?: number;
  /** Archive stopped sessions idle for 7+ days automatically; on when omitted. */
  autoSettle?: boolean;
  /** Background git status of every listed session's cwd; on when omitted, false = git never runs. */
  gitStatus?: boolean;
  /** A project workspace opens with the right sidebar shown; off when omitted. */
  rightSidebarOpen?: boolean;
  /** Each project keeps its own right sidebar; off when omitted (all projects share one). */
  rightSidebarPerProject?: boolean;
  /** Toast when a session needs you / finishes / fails and is not on screen; on when omitted. */
  notifyNeedsYou?: boolean;
  /** Slash command put before the task text when the Task panel starts a task; blank = the text alone. */
  taskSkill?: string;
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
  /** Where the usage section sits: above (top) or below (bottom, default) the sessions tree. */
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
  'usage.showCost'?: boolean;
  /** Percent where each bar turns yellow (warnAt) and red (critAt), 0-100 with critAt above warnAt; defaults 20/50 context, 50/80 5h, 70/90 weekly. */
  'usage.context.warnAt'?: number;
  'usage.context.critAt'?: number;
  'usage.fiveHour.warnAt'?: number;
  'usage.fiveHour.critAt'?: number;
  'usage.sevenDay.warnAt'?: number;
  'usage.sevenDay.critAt'?: number;
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
