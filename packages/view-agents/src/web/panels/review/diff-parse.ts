export interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'ctx';
  oldNo?: number;
  newNo?: number;
  text: string;
}

/** Lines of a unified diff (header lines dropped) with their old/new numbers. */
export function parseDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of text.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      inHunk = true;
      out.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (!inHunk || raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) out.push({ kind: 'add', newNo: newNo++, text: raw.slice(1) });
    else if (raw.startsWith('-')) out.push({ kind: 'del', oldNo: oldNo++, text: raw.slice(1) });
    else if (raw.startsWith(' ')) out.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text: raw.slice(1) });
  }
  return out;
}

/** A unified diff that adds every line of `text` (a new file). */
export function addedDiff(text: string): string {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length ? `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}` : '';
}
