/** Agents wire types shared by the server and the web UI (no server imports). */

export interface AgentAccount {
  id: string;
  dir: string;
  email?: string;
  label: string;
  isDefault: boolean;
}

/** UI status: Running, Waiting (`needs-you`), Done (unseen), Idle, Starting, Error (shown on screen), Exited, Stopped. */
export type AgentStatus = 'running' | 'needs-you' | 'done' | 'idle' | 'starting' | 'error' | 'exited' | 'stopped';

/** Category of a status: Starting + Running = running; Done + Waiting = waiting; Exited + Error = error. */
export type AgentCategory = 'running' | 'waiting' | 'idle' | 'error' | 'stopped';

export const STATUS_CATEGORY: Record<AgentStatus, AgentCategory> = { starting: 'running', running: 'running', done: 'waiting', 'needs-you': 'waiting', idle: 'idle', exited: 'error', error: 'error', stopped: 'stopped' };

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
  /** Pinned to the top of its project. */
  pinned?: boolean;
  /** App-side name overriding the title. */
  name?: string;
  /** Hidden under the collapsed Archived section. */
  archived?: boolean;
}

/** Stored pin / rename / archive state of one session (`PATCH /api/agents/session-state`). */
export interface AgentSessionState {
  pinned?: boolean;
  name?: string;
  archived?: boolean;
}

/** Notes of a project (`GET /api/agents/notes?project=`). */
export interface AgentNotes {
  text: string;
}

/** Body of `PUT /api/agents/notes`; the reply is `{ ok }`. */
export interface AgentNotesWrite {
  project: string;
  text: string;
}

/** One line of the streamed `GET /api/agents/search?q=` ndjson (first match per session). */
export interface AgentSearchHit {
  sessionId: string;
  snippet: string;
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
  /** A process runs it now (pid record, starting or exited pty); false for an offline session showing Done / Exited from an unseen mark. */
  live?: boolean;
  /** Claude is running this session in another terminal (live pid file that is not ours). */
  external?: boolean;
  /** `starting`: our terminal runs it but Claude's pid file has not appeared yet; `exited`: the process ended and its terminal is still listed. */
  lifecycle?: 'starting' | 'exited';
  /** Exit code when `lifecycle` is `exited` (null = no code). */
  exitCode?: number | null;
}

/** Why a session start / restart / stop was refused. */
export type AgentLifecycleError = 'cwdMissing' | 'external' | 'unknownSession' | 'unknownAccount' | 'busy';

/** Reply of `POST /api/agents/session/restart` and (with `dir`) `POST /api/agents/terminal/prepare`: the launcher args for `POST /api/terminal/open`. */
export type AgentLaunch =
  | { ok: true; sessionId: string; launch: { id: string; args: unknown }; cwd?: string; warn?: AgentsCapWarn }
  | { ok: false; error: AgentLifecycleError; cwd?: string };

/** Reply of `POST /api/agents/session/stop`: `removed` when nothing was sent, so the session no longer exists. */
export interface AgentStopResult {
  ok: boolean;
  removed?: boolean;
  error?: AgentLifecycleError;
}

/** Socket text frames: the full session list when it changes, else only the status map (session id -> status); `usage` when plan usage changes. */
export type AgentsFrame =
  | { type: 'sessions'; sessions: AgentSessionView[] }
  | { type: 'status'; status: Record<string, AgentStatus> }
  | { type: 'usage'; accounts: AgentAccountUsage[] }
  | { type: 'tail'; sessionId: string; turns: Array<{ role: 'user' | 'assistant'; text: string }> };

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
