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
  /** Token sums over the transcript's assistant `message.usage` entries (each message counted once). */
  tokens?: AgentTokens;
  /** Context window used, 0-100: from the statusLine usage file, else the last assistant turn vs the model's window; absent when unknown. */
  contextPercent?: number;
}

export interface AgentTokens {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/** One plan rate-limit window: percent used and when it resets (ms epoch). */
export interface AgentRateLimit {
  percent: number;
  resetsAt?: number;
}

/** Plan usage of an account, from its newest statusLine usage file that carries `rate_limits`. */
export interface AgentAccountUsage {
  account: string;
  label: string;
  updatedAt: number;
  fiveHour?: AgentRateLimit;
  sevenDay?: AgentRateLimit;
}

/** A session as the UI gets it: its status and the project its cwd belongs to. */
export interface AgentSessionView extends AgentSession {
  status: AgentStatus;
  /** Id of the added project the cwd belongs to. */
  project?: string;
  seenAt?: number;
  /** Claude is running this session in another terminal (live pid file that is not ours). */
  external?: boolean;
}

/** Socket text frames: the full session list when it changes, else only the status map (session id -> status); `usage` when plan usage changes. */
export type AgentsFrame =
  | { type: 'sessions'; sessions: AgentSessionView[] }
  | { type: 'status'; status: Record<string, AgentStatus> }
  | { type: 'usage'; accounts: AgentAccountUsage[] };

/** A project added to the Agents view. */
export interface AgentProject {
  id: string;
  name: string;
  path: string;
}

/** A session the previous run left live (`GET /api/agents/recovery`), with what the banner and resume need. */
export interface AgentRunning {
  id: string;
  account: string;
  mode: 'terminal' | 'chat';
  project?: string;
  title: string;
  cwd: string;
}

/** Sent with a session start when live sessions reached the soft cap. */
export interface AgentsCapWarn {
  live: number;
  cap: number;
}

/** What the statusLine script stores per session in `<dataDir>/agents/usage/<account>/<sessionId>.json` (keys the CLI did not send are absent). */
export interface AgentUsage {
  updatedAt: number;
  sessionId: string;
  model?: { id?: string; display_name?: string };
  context_window?: { used_percentage?: number | null; context_window_size?: number; total_input_tokens?: number; total_output_tokens?: number; [k: string]: unknown };
  rate_limits?: {
    five_hour?: { used_percentage?: number; resets_at?: number };
    seven_day?: { used_percentage?: number; resets_at?: number };
  };
}

/** Install state of the usage statusLine for one account (`GET /api/agents/statusline`). */
export interface AgentStatuslineStatus {
  account: string;
  label: string;
  /** The account's `settings.json` statusLine is the DeckBuilder one. */
  installed: boolean;
  /** Command of the statusLine that is chained (kept for uninstall); absent when there was none. */
  previous?: string;
  /** `settings.json` exists and parses; install is refused otherwise. */
  settingsOk: boolean;
}

export type AgentStatuslineError = 'unknownAccount' | 'invalidSettings' | 'writeFailed';
