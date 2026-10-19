import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatEvent, ChatUsage } from '../../chat-protocol.ts';

const MAX_RESULT = 20_000;
const INTERRUPT_TEXT = '[Request interrupted by user';

const TASK_NOTIFICATION = '<task-notification>';

type Json = Record<string, any>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
  return content.map((c) => (isObj(c) && typeof c.text === 'string' ? c.text : isObj(c) ? `[${String(c.type)}]` : String(c))).join('\n');
}

/** User-role text as an event: interrupt marker, background-task notification (summary only), or a real user message. */
function userEvent(text: string): ChatEvent {
  if (text.startsWith(INTERRUPT_TEXT)) return { type: 'interrupted' };
  if (text.trimStart().startsWith(TASK_NOTIFICATION)) {
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1].trim();
    return { type: 'notice', text: summary || 'Background task finished' };
  }
  return { type: 'user', text };
}

function usageOf(u: unknown): ChatUsage | undefined {
  if (!isObj(u)) return undefined;
  const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
  return {
    inputTokens: n('input_tokens'),
    outputTokens: n('output_tokens'),
    cacheReadTokens: n('cache_read_input_tokens'),
    cacheCreationTokens: n('cache_creation_input_tokens'),
  };
}

/**
 * One stream-json stdout line, or one session jsonl line, as chat events. Both formats share the message shapes;
 * everything else (hooks, status, rate limits, queue-operation, attachments, control responses...) gives `[]`.
 */
export function normalizeLine(raw: unknown): ChatEvent[] {
  if (!isObj(raw)) return [];
  if (raw.isSidechain === true || raw.isMeta === true) return [];
  const parent = typeof raw.parent_tool_use_id === 'string' ? raw.parent_tool_use_id : undefined;
  const parentId = parent ? { parentId: parent } : {};
  switch (raw.type) {
    case 'system':
      if (raw.subtype !== 'init' || typeof raw.session_id !== 'string') return [];
      return [
        {
          type: 'init',
          sessionId: raw.session_id,
          model: typeof raw.model === 'string' ? raw.model : undefined,
          tools: Array.isArray(raw.tools) ? raw.tools.filter((t): t is string => typeof t === 'string') : [],
          cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
        },
      ];
    case 'assistant': {
      const msg = raw.message;
      if (!isObj(msg) || !Array.isArray(msg.content)) return [];
      const messageId = typeof msg.id === 'string' ? msg.id : undefined;
      const out: ChatEvent[] = [];
      for (const b of msg.content) {
        if (!isObj(b)) continue;
        if (b.type === 'text' && typeof b.text === 'string' && b.text) out.push({ type: 'text', text: b.text, messageId, ...parentId });
        else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking) out.push({ type: 'thinking', text: b.thinking, ...parentId });
        else if (b.type === 'tool_use' && typeof b.id === 'string') out.push({ type: 'tool_use', id: b.id, name: String(b.name), input: b.input, ...parentId });
      }
      return out;
    }
    case 'user': {
      const msg = raw.message;
      if (!isObj(msg)) return [];
      if (typeof msg.content === 'string') {
        if (!msg.content) return [];
        return [userEvent(msg.content)];
      }
      if (!Array.isArray(msg.content)) return [];
      const out: ChatEvent[] = [];
      for (const b of msg.content) {
        if (!isObj(b)) continue;
        if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          const full = resultText(b.content);
          const truncated = full.length > MAX_RESULT;
          out.push({
            type: 'tool_result',
            toolUseId: b.tool_use_id,
            content: truncated ? full.slice(0, MAX_RESULT) : full,
            isError: b.is_error === true,
            ...(truncated ? { truncated } : {}),
            ...parentId,
          });
        } else if (b.type === 'text' && typeof b.text === 'string' && b.text) {
          out.push(userEvent(b.text));
        }
      }
      return out;
    }
    case 'stream_event': {
      const d = raw.event?.delta;
      if (raw.event?.type !== 'content_block_delta' || !isObj(d) || d.type !== 'text_delta' || typeof d.text !== 'string' || parent) return [];
      return [{ type: 'delta', text: d.text, messageId: typeof raw.api_message_id === 'string' ? raw.api_message_id : undefined }];
    }
    case 'result':
      return [
        {
          type: 'result',
          subtype: String(raw.subtype ?? ''),
          isError: raw.is_error === true,
          aborted: raw.terminal_reason === 'aborted_streaming',
          text: typeof raw.result === 'string' ? raw.result : undefined,
          usage: usageOf(raw.usage),
          costUsd: typeof raw.total_cost_usd === 'number' ? raw.total_cost_usd : undefined,
          durationMs: typeof raw.duration_ms === 'number' ? raw.duration_ms : undefined,
        },
      ];
    default:
      return [];
  }
}

/** A session jsonl as chat events; unparsable lines are skipped. */
export function parseHistory(text: string): ChatEvent[] {
  const out: ChatEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(...normalizeLine(JSON.parse(line)));
    } catch {
      /* partial last line of a file being written */
    }
  }
  return out;
}

/** `<accountDir>/projects/<folder>/<sessionId>.jsonl`, or undefined. */
export function findSessionFile(accountDir: string, sessionId: string): string | undefined {
  if (!/^[\w-]+$/.test(sessionId)) return undefined;
  let folders: string[];
  try {
    folders = readdirSync(join(accountDir, 'projects'));
  } catch {
    return undefined;
  }
  for (const f of folders) {
    const p = join(accountDir, 'projects', f, `${sessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return undefined;
}

export function loadHistory(file: string): ChatEvent[] {
  try {
    return parseHistory(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

/** The cwd a session ran in: the first jsonl entry that records one. */
export function sessionCwd(file: string): string | undefined {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('"cwd"')) continue;
      const e = JSON.parse(line);
      if (typeof e.cwd === 'string') return e.cwd;
    }
  } catch {
    /* unreadable */
  }
  return undefined;
}
