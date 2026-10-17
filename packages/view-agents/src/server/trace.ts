import { readFileSync } from 'node:fs';
import type { AgentTraceStep } from '../protocol.ts';

const MAX_LABEL = 72;
const PRIMARY_KEYS = ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'description'];

const cap = (s: string) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s);
const firstLine = (s: string) => cap(s.trim().split('\n')[0]!.trim());

interface Block {
  type?: string;
  text?: unknown;
  id?: string;
  name?: unknown;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: unknown;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b: Block) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: Block) => b.text as string)
    .join('\n\n');
}

function toolLabel(name: unknown, input: unknown): string {
  const n = typeof name === 'string' && name ? name : 'tool';
  let arg = '';
  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>;
    const key = PRIMARY_KEYS.find((k) => rec[k] !== undefined && rec[k] !== null);
    const v = key ? rec[key] : undefined;
    if (typeof v === 'string' && v) arg = v.replace(/\s+/g, ' ').trim();
  }
  return cap(arg ? `${n}(${arg})` : n);
}

/** Ordered steps (user prompts, assistant replies, tool calls with their results) of a session jsonl. */
export function parseTrace(jsonl: string): AgentTraceStep[] {
  const steps: AgentTraceStep[] = [];
  const tools = new Map<string, AgentTraceStep>();
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let e: { type?: string; message?: { content?: unknown } };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const content = e?.message?.content;
    if (e?.type === 'user') {
      if (Array.isArray(content)) {
        for (const b of content as Block[]) {
          if (b?.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
          const step = tools.get(b.tool_use_id);
          if (!step) continue;
          const text = textOf(b.content).trim();
          const err = !!b.is_error;
          step.detail += `\n\n${err ? 'Error:' : 'Result:'} ${text || '(empty)'}`;
          if (err) step.error = true;
        }
      }
      const text = textOf(content).trim();
      if (text) steps.push({ kind: 'user', label: firstLine(text), detail: text });
    } else if (e?.type === 'assistant') {
      const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string') {
          const text = b.text.trim();
          if (text) steps.push({ kind: 'assistant', label: firstLine(text), detail: text });
        } else if (b?.type === 'tool_use') {
          const name = typeof b.name === 'string' && b.name ? b.name : 'tool';
          const step: AgentTraceStep = { kind: 'tool', label: toolLabel(b.name, b.input), detail: `${name}\n${b.input === undefined ? 'undefined' : JSON.stringify(b.input, null, 2)}` };
          steps.push(step);
          if (typeof b.id === 'string') tools.set(b.id, step);
        }
      }
    }
  }
  return steps;
}

export function readTrace(file: string): AgentTraceStep[] {
  try {
    return parseTrace(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}
