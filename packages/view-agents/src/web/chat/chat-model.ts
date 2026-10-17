import type { ChatEvent } from '../../chat-protocol.ts';

/** Adds a live event to the list: `delta`s of one message merge, a `text` replaces its `delta`s, thinking is dropped. */
export function applyEvent(events: ChatEvent[], ev: ChatEvent): ChatEvent[] {
  if (ev.type === 'thinking') return events;
  if (ev.type === 'delta') {
    const last = events[events.length - 1];
    if (last?.type === 'delta' && last.messageId === ev.messageId) {
      return [...events.slice(0, -1), { ...last, text: last.text + ev.text }];
    }
    return [...events, ev];
  }
  if (ev.type === 'text') {
    const kept = events.filter((e) => !(e.type === 'delta' && e.messageId === ev.messageId));
    return [...kept, ev];
  }
  return [...events, ev];
}

export type ToolResult = Extract<ChatEvent, { type: 'tool_result' }>;
export type TranscriptItem =
  | { kind: 'event'; event: Exclude<ChatEvent, { type: 'tool_use' | 'tool_result' | 'thinking' }> }
  | { kind: 'tool'; use: Extract<ChatEvent, { type: 'tool_use' }>; result?: ToolResult }
  | { kind: 'orphan'; result: ToolResult };

/** Pairs each `tool_use` with its `tool_result`; thinking is left out. */
export function transcriptItems(events: ChatEvent[]): TranscriptItem[] {
  const results = new Map<string, ToolResult>();
  const uses = new Set<string>();
  for (const e of events) {
    if (e.type === 'tool_result') results.set(e.toolUseId, e);
    else if (e.type === 'tool_use') uses.add(e.id);
  }
  const items: TranscriptItem[] = [];
  for (const e of events) {
    if (e.type === 'thinking') continue;
    if (e.type === 'tool_use') items.push({ kind: 'tool', use: e, result: results.get(e.id) });
    else if (e.type === 'tool_result') { if (!uses.has(e.toolUseId)) items.push({ kind: 'orphan', result: e }); }
    else items.push({ kind: 'event', event: e });
  }
  return items;
}

/** One-line summary of a tool input: the usual path/command/pattern field, else compact JSON. */
export function toolSummary(input: unknown): string {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['file_path', 'path', 'command', 'pattern', 'url', 'description', 'query']) {
      if (typeof o[k] === 'string') return o[k] as string;
    }
  }
  const s = JSON.stringify(input) ?? '';
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}
