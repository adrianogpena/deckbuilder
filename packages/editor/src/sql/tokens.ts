import { PLSQL } from '@codemirror/lang-sql';

export type TokenKind =
  | 'keyword'
  | 'identifier'
  | 'quotedIdentifier'
  | 'string'
  | 'qquote'
  | 'number'
  | 'operator'
  | 'punctuation'
  | 'bind'
  | 'lineComment'
  | 'blockComment'
  | 'whitespace'
  | 'newline'
  | 'slash';

export interface Token {
  kind: TokenKind;
  from: number;
  to: number;
  text: string;
}

export const SQL_KEYWORDS: ReadonlySet<string> = new Set(
  (PLSQL.spec.keywords ?? '').split(/\s+/).filter(Boolean).map((k) => k.toLowerCase()),
);

const CLOSERS: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };
const OPERATORS = ['||', '<=', '>=', '<>', '!=', '^=', '~=', ':=', '=>', '..', '**', '<<', '>>'];
const SINGLE_OPERATORS = '+-*/=<>!^~%|:';
const PUNCTUATION = '(),;.[]{}@';

const isIdentStart = (c: string): boolean => /[\p{L}_]/u.test(c);
const isIdentPart = (c: string): boolean => /[\p{L}\p{N}_$#]/u.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isBlank = (c: string): boolean => c === ' ' || c === '\t' || c === '\f' || c === '\v';

function quoted(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === quote) {
      if (text[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return text.length;
}

function qQuoteEnd(text: string, quoteAt: number): number {
  const open = text[quoteAt + 1]!;
  const close = CLOSERS[open] ?? open;
  const end = text.indexOf(close + "'", quoteAt + 2);
  return end < 0 ? text.length : end + 2;
}

function isOwnLine(text: string, i: number): boolean {
  for (let j = i - 1; j >= 0 && text[j] !== '\n'; j--) if (!isBlank(text[j]!) && text[j] !== '\r') return false;
  for (let j = i + 1; j < text.length && text[j] !== '\n'; j++) if (!isBlank(text[j]!) && text[j] !== '\r') return false;
  return true;
}

function numberEnd(text: string, start: number): number {
  let i = start;
  while (isDigit(text[i])) i++;
  if (text[i] === '.' && text[i + 1] !== '.') {
    i++;
    while (isDigit(text[i])) i++;
  }
  if (text[i] === 'e' || text[i] === 'E') {
    let j = i + 1;
    if (text[j] === '+' || text[j] === '-') j++;
    if (isDigit(text[j])) {
      while (isDigit(text[j])) j++;
      i = j;
    }
  }
  return i;
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i]!;
    const next = text[i + 1];
    let kind: TokenKind;
    let end: number;
    if (c === '\n' || (c === '\r' && next === '\n')) {
      kind = 'newline';
      end = c === '\r' ? i + 2 : i + 1;
    } else if (isBlank(c) || c === '\r') {
      kind = 'whitespace';
      end = i + 1;
      while (end < n && (isBlank(text[end]!) || (text[end] === '\r' && text[end + 1] !== '\n'))) end++;
    } else if (c === '-' && next === '-') {
      kind = 'lineComment';
      end = i + 2;
      while (end < n && text[end] !== '\n' && !(text[end] === '\r' && text[end + 1] === '\n')) end++;
    } else if (c === '/' && next === '*') {
      kind = 'blockComment';
      const close = text.indexOf('*/', i + 2);
      end = close < 0 ? n : close + 2;
    } else if (c === '/' && isOwnLine(text, i)) {
      kind = 'slash';
      end = i + 1;
    } else if (c === "'") {
      kind = 'string';
      end = quoted(text, i, "'");
    } else if (c === '"') {
      kind = 'quotedIdentifier';
      end = quoted(text, i, '"');
    } else if (isDigit(c) || (c === '.' && isDigit(next))) {
      kind = 'number';
      end = numberEnd(text, i);
    } else if (isIdentStart(c)) {
      end = i + 1;
      while (end < n && isIdentPart(text[end]!)) end++;
      const lower = text.slice(i, end).toLowerCase();
      if ((lower === 'q' || lower === 'nq') && text[end] === "'" && end + 1 < n && !/\s/.test(text[end + 1]!)) {
        kind = 'qquote';
        end = qQuoteEnd(text, end);
      } else if (lower === 'n' && text[end] === "'") {
        kind = 'string';
        end = quoted(text, end, "'");
      } else {
        kind = SQL_KEYWORDS.has(lower) ? 'keyword' : 'identifier';
      }
    } else if (c === ':' && next !== undefined && isIdentPart(next)) {
      kind = 'bind';
      end = i + 2;
      while (end < n && isIdentPart(text[end]!)) end++;
    } else if (OPERATORS.includes(c + (next ?? ''))) {
      kind = 'operator';
      end = i + 2;
    } else if (SINGLE_OPERATORS.includes(c)) {
      kind = 'operator';
      end = i + 1;
    } else if (PUNCTUATION.includes(c)) {
      kind = 'punctuation';
      end = i + 1;
    } else {
      kind = 'operator';
      end = i + 1;
    }
    tokens.push({ kind, from: i, to: end, text: text.slice(i, end) });
    i = end;
  }
  return tokens;
}
