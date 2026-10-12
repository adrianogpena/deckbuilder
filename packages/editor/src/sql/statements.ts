import { tokenize, type Token } from './tokens.ts';

export interface Statement {
  from: number;
  to: number;
  text: string;
}

const TRIVIA = new Set(['whitespace', 'newline', 'lineComment', 'blockComment']);
const CREATE_SKIP = new Set(['or', 'replace', 'editionable', 'noneditionable']);
const CREATE_PLSQL = new Set(['procedure', 'function', 'package', 'trigger']);

function words(tokens: Token[], start: number, max: number): string[] {
  const out: string[] = [];
  for (let i = start; i < tokens.length && out.length < max; i++) {
    const t = tokens[i]!;
    if (TRIVIA.has(t.kind)) continue;
    if (t.kind !== 'keyword' && t.kind !== 'identifier') break;
    out.push(t.text.toLowerCase());
  }
  return out;
}

export function isPlsqlStart(tokens: Token[], start: number): boolean {
  const w = words(tokens, start, 8);
  if (w[0] === 'begin' || w[0] === 'declare') return true;
  if (w[0] !== 'create') return false;
  let i = 1;
  while (i < w.length && CREATE_SKIP.has(w[i]!)) i++;
  const kind = w[i];
  if (kind === undefined) return false;
  if (CREATE_PLSQL.has(kind)) return true;
  return kind === 'type' && w[i + 1] === 'body';
}

export function splitStatements(text: string): Statement[] {
  const tokens = tokenize(text);
  const out: Statement[] = [];
  let start = 0;
  let started = false;
  let plsql = false;

  const push = (to: number): void => {
    if (started) {
      const raw = text.slice(start, to);
      const lead = raw.length - raw.trimStart().length;
      const trimmed = raw.trim();
      if (trimmed) out.push({ from: start + lead, to: start + lead + trimmed.length, text: trimmed });
    }
    started = false;
    plsql = false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'slash') {
      push(t.from);
      start = t.to;
      continue;
    }
    if (TRIVIA.has(t.kind)) continue;
    if (!started) {
      started = true;
      plsql = isPlsqlStart(tokens, i);
    }
    if (t.kind === 'punctuation' && t.text === ';' && !plsql) {
      push(t.from);
      start = t.to;
    }
  }
  push(text.length);
  return out;
}

export function statementAt(text: string, offset: number): Statement | undefined {
  const statements = splitStatements(text);
  let before: Statement | undefined;
  for (const s of statements) {
    if (offset >= s.from && offset <= s.to) return s;
    if (s.to < offset) before = s;
  }
  return before ?? statements[0];
}
