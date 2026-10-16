/** Agents wire types shared by the server and the web UI (no server imports). */

export interface AgentAccount {
  id: string;
  dir: string;
  email?: string;
  label: string;
  isDefault: boolean;
}

export type AgentStatus = 'error' | 'needs-you' | 'running' | 'done' | 'idle' | 'stopped';

export interface AgentSession {
  id: string;
  account: string;
  cwd: string;
  title: string;
  firstPrompt: string;
  updatedAt: number;
  gitBranch?: string;
  model?: string;
}

/** A session as the UI gets it: its status and the project its cwd belongs to. */
export interface AgentSessionView extends AgentSession {
  status: AgentStatus;
  /** Id of the added project the cwd belongs to. */
  project?: string;
  seenAt?: number;
}

/** Socket text frames: the full session list when it changes, else only the status map (session id -> status). */
export type AgentsFrame =
  | { type: 'sessions'; sessions: AgentSessionView[] }
  | { type: 'status'; status: Record<string, AgentStatus> };

/** A project added to the Agents view. */
export interface AgentProject {
  id: string;
  name: string;
  path: string;
}
