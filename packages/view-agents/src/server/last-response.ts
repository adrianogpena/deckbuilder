import { readFileSync } from 'node:fs';

/** Text of the last assistant message with non-empty text in a session jsonl (text blocks joined; thinking and tool use ignored). */
export function lastResponseText(jsonl: string): string | null {
  const lines = jsonl.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"assistant"')) continue;
    try {
      const e = JSON.parse(line);
      if (e?.type !== 'assistant') continue;
      const content = e.message?.content;
      const text = (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b: { type?: string; text?: unknown }) => b?.type === 'text' && typeof b.text === 'string').map((b: { text: string }) => b.text).join('\n\n') : '').trim();
      if (text) return text;
    } catch {
      /* partial line */
    }
  }
  return null;
}

export function lastResponse(file: string): string | null {
  try {
    return lastResponseText(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
