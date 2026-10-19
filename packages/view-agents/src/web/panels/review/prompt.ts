export interface PromptComment {
  path: string;
  line: number;
  removed?: boolean;
  text: string;
}

/** One prompt for the agent: a `file:line - comment` item per comment, then the summary. */
export function reviewPrompt(comments: PromptComment[], summary: string): string {
  const items = comments.map((c) => `- ${c.path}:${c.line}${c.removed ? ' (removed line)' : ''} - ${c.text.trim()}`);
  const parts = ['Code review comments:', ...items];
  if (summary.trim()) parts.push('', `Summary: ${summary.trim()}`);
  return parts.join('\n');
}

/** `<action> this code from <file>:<lines>:` followed by the code block. */
export function askPrompt(action: string, path: string, lines: string | undefined, code: string): string {
  return `${action} this code from ${path}${lines ? `:${lines}` : ''}:\n\`\`\`\n${code}\n\`\`\``;
}

/** "3" or "3-5" for the 1-based lines of `needle`'s first occurrence in `doc`; undefined when absent. */
export function linesOf(doc: string, needle: string): string | undefined {
  const at = needle ? doc.indexOf(needle) : -1;
  if (at < 0) return undefined;
  const from = doc.slice(0, at).split('\n').length;
  const to = from + needle.replace(/\n$/, '').split('\n').length - 1;
  return to > from ? `${from}-${to}` : String(from);
}
