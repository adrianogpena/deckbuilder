import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { CommandDef } from '@kedalion/ui';
import type { AgentAccount, AgentAccountUsage, AgentProject, AgentSessionView } from '../api';
import type { GitStatusMap } from '../git';
import type { UsageSettings } from '../UsageView';
import type { PanelKind } from './types';

/** The handles an agent tab's terminal gives the screen: insert text (no Enter) and submit it. */
export interface TerminalInput {
  insert(text: string): void;
  submit(text: string): void;
}

/**
 * What the Agents screen gives every panel through context (`useAgentsHost()`): the live feed and the session actions.
 * A panel reads this instead of taking props, so a panel module stays `{ project, params, api }`.
 */
export interface AgentsHost {
  sessions: AgentSessionView[];
  git: GitStatusMap;
  usage: AgentAccountUsage[];
  usageSettings?: UsageSettings;
  /** Setting `agents.rightSidebarOpen`: a workspace mounts with its right sidebar open. */
  rightSidebarOpen?: boolean;
  /** Setting `agents.taskSkill`: slash command the Task panel puts before the task text. */
  taskSkill?: string;
  /** Setting `agents.rightSidebarPerProject`: false = every workspace uses the shared `sharedSide` state. */
  rightSidebarPerProject?: boolean;
  sharedSide: { side: PanelKind[]; setSide: Dispatch<SetStateAction<PanelKind[]>>; open: boolean; setOpen: Dispatch<SetStateAction<boolean>>; folded: PanelKind[]; setFolded: Dispatch<SetStateAction<PanelKind[]>> };
  projects: AgentProject[];
  accounts: AgentAccount[];
  /** App commands whose keys still work while a terminal has the focus. */
  appKeys: CommandDef[];
  /** The Claude session of the focused agent tab of the shown workspace. */
  selectedId: string | undefined;
  /** Sessions the user stopped (exit bar reads "Session stopped") and sessions whose resume bar was dismissed. */
  userStopped: ReadonlySet<string>;
  resumeDismissed: ReadonlySet<string>;
  dismissResume(sessionId: string): void;
  stop(s: AgentSessionView): void;
  restart(s: AgentSessionView): void;
  startBackground(s: AgentSessionView): void;
  /** Ends an exited session's terminal so it reads as stopped. */
  clearExited(sessionId: string): void;
  copyResponse(sessionId: string): void;
  /** Id of the added project whose folder is `path`. */
  projectIdOf(path: string): string | undefined;
  /** Starts a new Claude session in the project folder (`account`: its id; none: the active account, via the start flow). */
  newSession(project: string, account?: string): void;
  /** Shows an error banner. */
  setError(message: string): void;
  /** Registers how to type into a session's terminal (null: gone). */
  registerTerminal(sessionId: string, input: TerminalInput | null): void;
  /** Types into the session's terminal (no Enter). */
  sendToSession(sessionId: string, text: string): void;
  /** Focuses the visible terminal input soon (it may still be mounting). */
  focusSoon(): void;
}

const Ctx = createContext<AgentsHost | undefined>(undefined);

export const AgentsHostProvider = Ctx.Provider;

export function useAgentsHost(): AgentsHost {
  const host = useContext(Ctx);
  if (!host) throw new Error('useAgentsHost outside AgentsScreen');
  return host;
}
