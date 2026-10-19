/** Transcript event types, shared by the server (`server/tail.ts`, history loader) and the web UI. */

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
  /** A system-generated message stored as a user turn (background task finished); `text` is its summary line. */
  | { type: 'notice'; text: string }
  /** Turn end. `aborted` when it ended by an interrupt. */
  | { type: 'result'; subtype: string; isError: boolean; aborted: boolean; text?: string; usage?: ChatUsage; costUsd?: number; durationMs?: number }
  | { type: 'error'; message: string };
