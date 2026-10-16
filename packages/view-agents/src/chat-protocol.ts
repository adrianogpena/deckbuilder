/** Chat mode wire types, shared by the server (`server/chat/*`) and the web UI. JSON text frames only. */

export const CHAT_SOCKET_PATH = '/api/agents/chat-socket';

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Events the engine and the jsonl history loader both produce. Subagent messages carry `parentId` (the Task tool_use id). */
export type ChatEvent =
  | { type: 'init'; sessionId: string; model?: string; tools: string[]; cwd?: string }
  | { type: 'user'; text: string }
  /** An assistant text block; replaces the `delta`s of the same `messageId`. */
  | { type: 'text'; text: string; messageId?: string; parentId?: string }
  /** Streaming fragment of the text being written (live only, never in history). */
  | { type: 'delta'; text: string; messageId?: string }
  | { type: 'thinking'; text: string; parentId?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; parentId?: string }
  /** Pair with its `tool_use` by `toolUseId`; `content` is cut at 20000 chars (`truncated`). */
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean; truncated?: boolean; parentId?: string }
  /** The user interrupted the running turn. */
  | { type: 'interrupted' }
  /** Turn end. `aborted` when it ended by an interrupt. */
  | { type: 'result'; subtype: string; isError: boolean; aborted: boolean; text?: string; usage?: ChatUsage; costUsd?: number; durationMs?: number }
  | { type: 'error'; message: string };

export interface QueuedMessage {
  id: string;
  text: string;
}

export interface PermissionRequest {
  /** Answer it with a `permission` client frame carrying this id. */
  id: string;
  toolName: string;
  input: unknown;
  toolUseId?: string;
}

export type PermissionDecision = 'allow' | 'always' | 'deny';

export type ChatRunState = 'idle' | 'running' | 'closed';

export interface ChatState {
  run: ChatRunState;
  queue: QueuedMessage[];
  permissions: PermissionRequest[];
  permissionMode: PermissionMode;
  /** Tool keys allowed for the rest of this chat (the "Always" answers). */
  always: string[];
}

/**
 * First frame of a chat socket. An existing session needs only `sessionId` (account and cwd come from its jsonl);
 * a new chat needs `cwd` (and `accountId`, default account when missing). Spawning waits for the first `send`.
 */
export interface ChatOpenFrame {
  type: 'open';
  sessionId?: string;
  cwd?: string;
  accountId?: string;
  permissionMode?: PermissionMode;
  model?: string;
}

export type ChatClientFrame =
  | ChatOpenFrame
  | { type: 'send'; text: string }
  | { type: 'queue-edit'; id: string; text: string }
  | { type: 'queue-remove'; id: string }
  | { type: 'interrupt' }
  | { type: 'permission'; requestId: string; decision: PermissionDecision }
  /** Takes effect on the next process start (a running turn finishes first). */
  | { type: 'set-mode'; mode: PermissionMode };

export type ChatServerFrame =
  | { type: 'opened'; sessionId?: string; cwd: string; accountId: string; model?: string }
  /** The jsonl history on open, before any live event. */
  | { type: 'history'; events: ChatEvent[] }
  | { type: 'event'; event: ChatEvent }
  | ({ type: 'state' } & ChatState)
  | { type: 'error'; code: string; message: string };
