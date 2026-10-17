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

export type AgentPin = 'top' | 'bottom';

/** A tree folder: random 8-hex id, a label, and the project keys in it (stored order). */
export interface AgentTreeFolder {
  id: string;
  name: string;
  projects: string[];
}

export type AgentTreeSort = 'manual' | 'recent' | 'actionable';
export type AgentTreeView = 'normal' | 'active';

/** `<dataDir>/agents/tree.json`, all keyed by project key (`GET`/`PATCH /api/agents/tree`). */
export interface AgentTree {
  folders: AgentTreeFolder[];
  topOrder: string[];
  sessionOrder: Record<string, string[]>;
  /** Node keys: `folder:<id>` and `project:<project key>`. */
  collapsed: string[];
  sort: AgentTreeSort;
  view: AgentTreeView;
}

/** Body of `PATCH /api/agents/tree`; the reply is `{ ok, error?, tree }`. */
export type AgentTreePatch =
  | { collapse: { key: string; collapsed: boolean } }
  | { sort: AgentTreeSort }
  | { view: AgentTreeView }
  | { move: { kind: 'folder'; id: string; dir: -1 | 1 } }
  | { move: { kind: 'project'; key: string; dir: -1 | 1; folder?: string; displayed: string[] } }
  | { move: { kind: 'session'; project: string; id: string; dir: -1 | 1; displayed: string[] } }
  | { freeze: Record<string, string[]> }
  | { newSession: { project: string; id: string } }
  | { clearedId: { project: string; oldId: string; newId: string } }
  | { folderCreate: { name: string } }
  | { folderRename: { id: string; name: string } }
  | { folderDelete: { id: string } }
  /** `keys` are distinct project keys in order; `folder` absent = the top-level manual order. */
  | { moveToFolder: { keys: string[]; folder?: string } };

/** One row of `GET /api/agents/tags`: a distinct tag and the number of listed sessions carrying it. */
export interface AgentTagCount {
  tag: string;
  count: number;
}

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
  /** Held at the top or bottom of its project. */
  pin?: AgentPin;
  /** Derived: `pin === 'top'`. */
  pinned?: boolean;
  /** App-side name overriding the title. */
  name?: string;
  /** Hidden under the collapsed Archived section. */
  archived?: boolean;
  /** Normalised tags (the field is absent when empty). */
  tags?: string[];
}

/** Stored pin / rename / archive state of one session (`PATCH /api/agents/session-state`). */
export interface AgentSessionState {
  pin?: AgentPin;
  name?: string;
  archived?: boolean;
  tags?: string[];
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

/** Why a delete or restore was refused (`empty`: nothing to undo). */
export type AgentTrashError = 'running' | 'nothing' | 'gone' | 'exists' | 'empty';

/** Reply of `POST /api/agents/session/delete` (body `{id}` or `{ids}`): per-id outcomes. */
export interface AgentDeleteResult {
  deleted: string[];
  skipped: Array<{ id: string; error: AgentTrashError }>;
}

export interface AgentTrashEntry {
  id: string;
  agent: string;
  title: string;
  originalPath: string;
  trashedAt: number;
}

/** Reply of `POST /api/agents/trash/restore` and `/undo`: the restored session, or a refusal. */
export type AgentRestoreResult = { ok: true; id: string; title: string } | { ok: false; error: AgentTrashError };

/** Reply of `POST /api/agents/session/stop`: `removed` when nothing was sent, so the session no longer exists. */
export interface AgentStopResult {
  ok: boolean;
  removed?: boolean;
  error?: AgentLifecycleError;
}

/** Git state of a session cwd (`git status --porcelain=v2 --branch`); branch is null when detached. */
export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: number;
}

/** Socket text frames: the full session list when it changes, else only the status map (session id -> status); `usage` when plan usage changes; `git` (cwd -> status) after each git poll. */
export type AgentsFrame =
  | { type: 'sessions'; sessions: AgentSessionView[] }
  | { type: 'status'; status: Record<string, AgentStatus> }
  | { type: 'usage'; accounts: AgentAccountUsage[] }
  | { type: 'git'; status: Record<string, GitStatus> }
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
