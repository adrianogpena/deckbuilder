import type { SqlFormatOptions } from './formatOptions.ts';
export { DEFAULT_FORMAT_OPTIONS, FORMAT_OPTION_META, type FormatOptionMeta, type SqlFormatOptions } from './formatOptions.ts';
import { isPlsqlStart, splitStatements } from './statements.ts';
import { tokenize, type Token } from './tokens.ts';

interface Item {
  tok: Token;
  comment: boolean;
  own: boolean;
  idx: number;
}

type Mode = 'select' | 'from' | 'cond' | 'set' | 'with' | 'insert' | 'inline' | 'list';

interface Clause {
  words: number;
  mode: Mode;
  deeper: boolean;
}

const CLAUSES: [string, Mode][] = [
  ['select', 'select'],
  ['from', 'from'],
  ['where', 'cond'],
  ['group by', 'list'],
  ['having', 'cond'],
  ['order siblings by', 'list'],
  ['order by', 'list'],
  ['union all', 'inline'],
  ['union', 'inline'],
  ['intersect', 'inline'],
  ['minus', 'inline'],
  ['except', 'inline'],
  ['connect by', 'cond'],
  ['start with', 'cond'],
  ['fetch', 'inline'],
  ['offset', 'inline'],
  ['limit', 'inline'],
  ['for update', 'inline'],
  ['insert into', 'insert'],
  ['values', 'inline'],
  ['update', 'inline'],
  ['set', 'set'],
  ['delete from', 'inline'],
  ['delete', 'inline'],
  ['returning', 'inline'],
];

const CLAUSE_WORDS = CLAUSES.map(([text, mode]) => ({ words: text.split(' '), mode }));
const JOIN_MODIFIERS = new Set(['inner', 'left', 'right', 'full', 'cross', 'natural', 'outer']);
const DML_START = new Set(['select', 'with', 'insert', 'update', 'delete']);
const SPACE_BEFORE_PAREN = new Set([
  'in', 'and', 'or', 'not', 'on', 'using', 'values', 'from', 'join', 'where', 'as', 'exists', 'any', 'all', 'some',
  'between', 'then', 'else', 'when', 'select', 'set', 'by', 'like', 'over', 'partition', 'into', 'union', 'intersect',
  'minus', 'except', 'having', 'case', 'is', 'with', 'distinct', 'update', 'delete', 'insert', 'returning', 'of',
  'apply', 'lateral',
]);
const EXTRA_KEYWORDS = new Set(['over', 'null', 'offset', 'siblings', 'merge', 'matched']);
const VALUE_KEYWORDS = new Set(['end', 'null', 'true', 'false', 'level', 'user', 'rownum', 'rowid', 'sysdate']);
const KNOWN_OPERATORS = new Set(['||', '<=', '>=', '<>', '!=', '^=', '~=', ':=', '=>', '..', '**', '<<', '>>', '+', '-', '*', '/', '=', '<', '>', '!', '^', '~', '%', '|', ':']);

class Unformattable extends Error {}

class Printer {
  private lines: string[] = [];
  private text = '';
  private started = false;
  level = 0;
  head = false;
  breakAt: number | null = null;

  constructor(private readonly unit: string) {}

  has(): boolean {
    return this.started;
  }

  newline(level: number, head = false): void {
    this.flush();
    this.level = level;
    this.head = head;
    this.breakAt = null;
  }

  breakNext(level: number): void {
    this.breakAt = level;
  }

  word(text: string, space: boolean): void {
    if (this.breakAt !== null) this.newline(this.breakAt);
    if (this.started) this.text += (space ? ' ' : '') + text;
    else {
      this.started = true;
      this.text = text;
    }
  }

  trail(text: string): void {
    if (this.started) this.text += ' ' + text;
    else this.word(text, false);
  }

  finish(eol: string): string {
    this.flush();
    return this.lines.join(eol);
  }

  private flush(): void {
    if (!this.started) return;
    this.lines.push(this.unit.repeat(this.level) + this.text);
    this.started = false;
    this.text = '';
  }
}

const isBlank = (t: Token): boolean => t.kind === 'whitespace' || t.kind === 'newline';
const isPunct = (t: Token, text: string): boolean => t.kind === 'punctuation' && t.text === text;

function applyCase(text: string, mode: 'upper' | 'lower' | 'preserve'): string {
  return mode === 'upper' ? text.toUpperCase() : mode === 'lower' ? text.toLowerCase() : text;
}

const caseOf = (text: string, o: SqlFormatOptions): string => applyCase(text, o.keywordCase);

const MERGING = new Set(['--', '/*', '*/']);

const isKeyword = (t: Token): boolean => t.kind === 'keyword' || (t.kind === 'identifier' && EXTRA_KEYWORDS.has(t.text.toLowerCase()));

function caseOnly(tokens: Token[], o: SqlFormatOptions): string {
  let out = '';
  let prev = '';
  for (const t of tokens) {
    out += isKeyword(t) && prev !== '.' ? caseOf(t.text, o) : t.text;
    if (!isBlank(t)) prev = t.text;
  }
  return out;
}

class Layout {
  private i = 0;
  private prev: Item | null = null;
  private prevSig: Item | null = null;
  private unary = false;
  private binary = false;
  private mode: Mode = 'inline';
  private readonly p: Printer;
  private readonly columns: number;

  constructor(
    private readonly items: Item[],
    private readonly o: SqlFormatOptions,
    mode: Mode = 'inline',
  ) {
    this.mode = mode;
    this.p = new Printer(o.indent === 'tab' ? '\t' : ' '.repeat(o.indent));
    this.columns = Math.max(1, Math.floor(o.columnsPerLine) || 1);
  }

  run(eol: string): string {
    this.query(0);
    if (this.i < this.items.length) throw new Unformattable();
    return this.p.finish(eol);
  }

  private isWord(it: Item | undefined): it is Item {
    return it !== undefined && !it.comment && (it.tok.kind === 'keyword' || it.tok.kind === 'identifier');
  }

  private lower(it: Item): string {
    return it.tok.text.toLowerCase();
  }

  private closes(it: Item | undefined): boolean {
    return it !== undefined && !it.comment && isPunct(it.tok, ')');
  }

  private nextNonComment(j: number): number {
    while (this.items[j]?.comment) j++;
    return j;
  }

  private clauseAt(j: number, first: boolean, afterDot = this.prevSig !== null && isPunct(this.prevSig.tok, '.')): Clause | null {
    if (!this.isWord(this.items[j])) return null;
    if (afterDot) return null;
    const w: string[] = [];
    for (let k = j; k < j + 4 && this.isWord(this.items[k]); k++) w.push(this.lower(this.items[k]!));
    if (first && w[0] === 'with') return { words: 1, mode: 'with', deeper: false };
    let m = 0;
    while (m < w.length && JOIN_MODIFIERS.has(w[m]!)) m++;
    if (m < w.length && (w[m] === 'join' || w[m] === 'apply')) return { words: m + 1, mode: 'inline', deeper: false };
    if (w[0] === 'on') return { words: 1, mode: 'cond', deeper: true };
    if (w[0] === 'using') return { words: 1, mode: 'inline', deeper: true };
    for (const c of CLAUSE_WORDS) {
      if (c.words.every((word, k) => w[k] === word)) return { words: c.words.length, mode: c.mode, deeper: false };
    }
    return null;
  }

  private leading(prev: Item | null): boolean {
    if (!prev) return true;
    const t = prev.tok;
    if (t.kind === 'punctuation') return t.text === '(' || t.text === ',' || t.text === '.';
    if (t.kind === 'operator') return true;
    if (t.kind === 'keyword') return !VALUE_KEYWORDS.has(t.text.toLowerCase());
    return false;
  }

  private parenSpace(prev: Item): boolean {
    if (prev.comment) return true;
    const t = prev.tok;
    if (t.kind === 'keyword' || t.kind === 'identifier') {
      if (SPACE_BEFORE_PAREN.has(t.text.toLowerCase())) return true;
      return t.kind === 'identifier' && this.mode === 'insert';
    }
    if (t.kind === 'quotedIdentifier') return this.mode === 'insert';
    return true;
  }

  private spaceBefore(it: Item): boolean {
    const prev = this.prev;
    if (!prev) return false;
    const t = it.tok;
    if (!it.comment && t.kind === 'punctuation') {
      if (t.text === ',' || t.text === ')' || t.text === '.' || t.text === '@' || t.text === ';') return false;
    }
    if (!prev.comment && prev.tok.kind === 'punctuation') {
      const x = prev.tok.text;
      if (x === '(' || x === '.' || x === '@') return false;
    }
    if (this.unary) return false;
    if (!this.o.spaceAroundOperators && !it.comment && !prev.comment) {
      const operator = t.kind === 'operator' && !this.leading(this.prevSig);
      if ((operator || this.binary) && !this.merges(prev.tok, t)) return false;
    }
    if (!it.comment && isPunct(t, '(')) return this.parenSpace(prev);
    return true;
  }

  private merges(a: Token, b: Token): boolean {
    if (a.kind !== 'operator' || b.kind !== 'operator') return false;
    const pair = a.text + b.text;
    return MERGING.has(pair) || KNOWN_OPERATORS.has(pair);
  }

  private isFunction(it: Item): boolean {
    const t = it.tok;
    if (t.kind !== 'identifier' || isKeyword(t)) return false;
    if (this.mode === 'insert' || this.mode === 'with') return false;
    const open = this.items[this.nextNonComment(it.idx + 1)];
    if (!open || !isPunct(open.tok, '(')) return false;
    const after = this.items[this.nextNonComment(open.idx + 1)];
    if (after && after.tok.kind === 'operator' && after.tok.text === '+') return false;
    return true;
  }

  private emit(it: Item, force = false): void {
    const t = it.tok;
    const afterDot = this.prevSig !== null && isPunct(this.prevSig.tok, '.');
    let text = t.text;
    if (!it.comment) {
      if ((force || isKeyword(t)) && !afterDot) text = caseOf(t.text, this.o);
      else if (!force && this.isFunction(it)) text = applyCase(t.text, this.o.functionCase);
    }
    const binary = !it.comment && t.kind === 'operator' && !this.leading(this.prevSig);
    let unary = false;
    if (!it.comment && t.kind === 'operator' && (t.text === '+' || t.text === '-')) unary = this.leading(this.prevSig);
    this.p.word(text, this.spaceBefore(it));
    this.prev = it;
    if (!it.comment) this.prevSig = it;
    this.unary = unary;
    this.binary = binary;
  }

  private comment(it: Item, look: ((j: number) => number | null) | null): void {
    const t = it.tok;
    const p = this.p;
    if (!it.own) {
      if (t.kind === 'lineComment') {
        p.trail(t.text);
        if (p.breakAt === null) p.breakNext(p.level + 1);
      } else if (p.breakAt !== null) p.trail(t.text);
      else {
        this.emit(it);
        this.i++;
        return;
      }
    } else {
      const hint = look ? look(this.nextNonComment(this.i)) : null;
      const level = hint ?? p.breakAt ?? p.level + (p.head ? 1 : 0);
      p.newline(level);
      p.word(t.text, false);
      p.breakNext(level);
    }
    this.prev = it;
    this.unary = false;
    this.binary = false;
    this.i++;
  }

  private query(indent: number, stay = false): void {
    const saved = this.mode;
    const items = this.items;
    const p = this.p;
    const look = (j: number): number | null => {
      const nx = items[j];
      if (!nx || this.closes(nx)) return indent;
      const m = this.clauseAt(j, false);
      if (m) return m.deeper ? indent + 1 : indent;
      if (this.mode === 'cond' && this.o.conditionPerLine && this.o.andOrPosition === 'before' && this.isWord(nx) && ['and', 'or'].includes(this.lower(nx))) return indent + 1;
      return null;
    };
    let col = 0;
    let between = false;
    let first = true;
    let stayFirst = stay;
    while (this.i < items.length) {
      const it = items[this.i]!;
      if (it.comment) {
        this.comment(it, look);
        continue;
      }
      const t = it.tok;
      if (this.closes(it)) break;
      if (isPunct(t, '(')) {
        first = false;
        this.paren();
        continue;
      }
      const clause = this.clauseAt(this.i, first);
      first = false;
      if (clause) {
        if (stayFirst) p.head = true;
        else if (!clause.deeper || this.o.joinConditionOnNewLine) p.newline(clause.deeper ? indent + 1 : indent, true);
        stayFirst = false;
        for (let k = 0; k < clause.words; k++) this.emit(items[this.i++]!, true);
        this.mode = clause.mode;
        col = 1;
        between = false;
        if (clause.mode === 'select') this.selectHead(indent);
        continue;
      }
      if (this.isWord(it)) {
        const w = this.lower(it);
        if (w === 'case') {
          const listLevel = this.mode === 'select' ? indent + 1 : null;
          if (this.caseExpr(listLevel) && listLevel !== null) col = this.columns;
          continue;
        }
        if (this.mode === 'cond') {
          if (w === 'between') between = true;
          else if (w === 'and' && between) between = false;
          else if (w === 'and' || w === 'or') {
            const split = this.o.conditionPerLine;
            if (split && this.o.andOrPosition === 'before') p.newline(indent + 1);
            this.emit(it);
            this.i++;
            if (split && this.o.andOrPosition === 'after') p.breakNext(indent + 1);
            continue;
          }
        }
      }
      this.emit(it);
      this.i++;
      if (isPunct(t, ',')) {
        if (this.mode === 'select') {
          if (col >= this.columns) {
            p.breakNext(indent + 1);
            col = 1;
          } else col++;
        } else if (this.mode === 'from') {
          if (this.o.fromTablesPerLine) p.breakNext(indent + 1);
        } else if (this.mode === 'set') {
          if (this.o.setItemsPerLine) p.breakNext(indent + 1);
        } else if (this.mode === 'list') {
          if (this.o.groupOrderListPerLine) p.breakNext(indent + 1);
        } else if (this.mode === 'with') p.breakNext(indent);
      }
    }
    this.mode = saved;
  }

  private selectHead(indent: number): void {
    const items = this.items;
    while (this.i < items.length) {
      const it = items[this.i]!;
      if (it.comment && !it.own && it.tok.kind === 'blockComment') this.emit(it);
      else if (this.isWord(it) && ['distinct', 'all', 'unique'].includes(this.lower(it))) this.emit(it, true);
      else break;
      this.i++;
    }
    if (this.o.newlineAfterSelect && !(this.o.singleColumnInline && this.singleItem())) this.p.breakNext(indent + 1);
  }

  private singleItem(): boolean {
    const items = this.items;
    let depth = 0;
    let last: Item | null = this.prevSig;
    for (let j = this.i; j < items.length; j++) {
      const it = items[j]!;
      if (it.comment) continue;
      if (isPunct(it.tok, '(')) depth++;
      else if (isPunct(it.tok, ')')) {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0) {
        if (isPunct(it.tok, ',')) return false;
        if (this.clauseAt(j, false, last !== null && isPunct(last.tok, '.'))) break;
      }
      last = it;
    }
    return true;
  }

  private paren(): void {
    const items = this.items;
    const next = items[this.nextNonComment(this.i + 1)];
    const subquery = this.isWord(next) && (this.lower(next) === 'select' || this.lower(next) === 'with');
    this.emit(items[this.i++]!);
    if (subquery) {
      const level = this.p.level;
      const split = this.o.subqueryNewlineAfterParen;
      if (split) this.p.breakNext(level + 1);
      this.query(level + 1, !split);
      if (!this.closes(items[this.i])) throw new Unformattable();
      if (this.o.subqueryCloseParenOnOwnLine || this.p.breakAt !== null) this.p.newline(level);
    } else {
      this.inline();
    }
    this.emit(items[this.i++]!);
  }

  private inline(): void {
    const items = this.items;
    while (this.i < items.length) {
      const it = items[this.i]!;
      if (it.comment) {
        this.comment(it, null);
        continue;
      }
      if (this.closes(it)) return;
      if (isPunct(it.tok, '(')) {
        this.paren();
        continue;
      }
      if (this.isWord(it) && this.lower(it) === 'case') {
        this.caseExpr();
        continue;
      }
      this.emit(it);
      this.i++;
    }
    throw new Unformattable();
  }

  private caseEnd(): number {
    const items = this.items;
    let depth = 0;
    for (let j = this.i; j < items.length; j++) {
      const it = items[j]!;
      if (!this.isWord(it)) continue;
      const w = this.lower(it);
      if (w === 'case') depth++;
      else if (w === 'end' && --depth === 0) return j;
    }
    return -1;
  }

  private caseBreaks(): boolean {
    const layout = this.o.caseLayout;
    if (layout !== 'auto') return layout === 'always';
    const end = this.caseEnd();
    if (end < 0) throw new Unformattable();
    const part = this.items.slice(this.i, end + 1);
    for (const it of part) {
      if (it.comment) return true;
      if (isPunct(it.tok, '(')) {
        const next = this.items[this.nextNonComment(it.idx + 1)];
        if (this.isWord(next) && (this.lower(next) === 'select' || this.lower(next) === 'with')) return true;
      }
    }
    const sub = new Layout(
      part.map((it, k) => ({ ...it, idx: k })),
      { ...this.o, caseLayout: 'never' },
      this.mode,
    );
    sub.caseExpr(null);
    const width = Number.isFinite(this.o.caseMaxWidth) ? Math.max(1, Math.floor(this.o.caseMaxWidth)) : 60;
    return sub.p.finish('\n').length > width;
  }

  private atItemStart(): boolean {
    const prev = this.prevSig;
    if (!prev) return true;
    if (isPunct(prev.tok, ',')) return true;
    return this.isWord(prev) && ['select', 'distinct', 'all', 'unique'].includes(this.lower(prev));
  }

  private caseExpr(listLevel: number | null = null): boolean {
    const items = this.items;
    const split = this.caseBreaks();
    if (split && listLevel !== null && this.atItemStart() && this.p.breakAt === null && this.p.has()) this.p.newline(listLevel);
    this.emit(items[this.i++]!, true);
    const level = this.p.level;
    const look = (j: number): number | null => {
      const nx = items[j];
      if (!split || !this.isWord(nx)) return null;
      const w = this.lower(nx);
      return w === 'when' || w === 'else' ? level + 1 : w === 'end' ? level : null;
    };
    while (this.i < items.length) {
      const it = items[this.i]!;
      if (it.comment) {
        this.comment(it, look);
        continue;
      }
      if (this.isWord(it)) {
        const w = this.lower(it);
        if (w === 'when' || w === 'else') {
          if (split) this.p.newline(level + 1);
          this.emit(it, true);
          this.i++;
          continue;
        }
        if (w === 'end') {
          if (split) this.p.newline(level);
          this.emit(it, true);
          this.i++;
          return split;
        }
        if (w === 'case') {
          this.caseExpr();
          continue;
        }
      }
      if (isPunct(it.tok, '(')) {
        this.paren();
        continue;
      }
      if (this.closes(it)) throw new Unformattable();
      this.emit(it);
      this.i++;
    }
    throw new Unformattable();
  }
}

function buildItems(tokens: Token[]): Item[] {
  const items: Item[] = [];
  let own = true;
  for (const tok of tokens) {
    if (tok.kind === 'whitespace') continue;
    if (tok.kind === 'newline') {
      own = true;
      continue;
    }
    const comment = tok.kind === 'lineComment' || tok.kind === 'blockComment';
    items.push({ tok, comment, own, idx: items.length });
    own = tok.kind === 'lineComment';
  }
  return items;
}

function layout(tokens: Token[], o: SqlFormatOptions, eol: string): string {
  const items = buildItems(tokens);
  const firstWord = items.find((it) => !it.comment);
  const start = firstWord?.tok.text.toLowerCase();
  if (!start || !DML_START.has(start)) throw new Unformattable();
  if (start === 'insert') {
    const second = items.filter((it) => !it.comment)[1]?.tok.text.toLowerCase();
    if (second === 'all' || second === 'first') throw new Unformattable();
  }
  let depth = 0;
  for (const { tok, comment } of items) {
    if (comment) continue;
    if (tok.kind === 'slash') throw new Unformattable();
    if (tok.kind === 'punctuation') {
      if (';[]{}'.includes(tok.text)) throw new Unformattable();
      if (tok.text === '(') depth++;
      if (tok.text === ')' && --depth < 0) throw new Unformattable();
    }
    if (tok.kind === 'operator' && !KNOWN_OPERATORS.has(tok.text)) throw new Unformattable();
  }
  if (depth !== 0) throw new Unformattable();
  return new Layout(items, o).run(eol);
}

function sameTokens(a: Token[], b: Token[]): boolean {
  const sig = (tokens: Token[]): Token[] => tokens.filter((t) => !isBlank(t));
  const x = sig(a);
  const y = sig(b);
  if (x.length !== y.length) return false;
  return x.every((t, k) => {
    const u = y[k]!;
    const word = (t.kind === 'keyword' || t.kind === 'identifier') && (u.kind === 'keyword' || u.kind === 'identifier');
    return word ? t.text.toLowerCase() === u.text.toLowerCase() : t.kind === u.kind && t.text === u.text;
  });
}

function formatStatement(text: string, o: SqlFormatOptions, eol: string): string {
  const tokens = tokenize(text);
  if (isPlsqlStart(tokens, 0)) return caseOnly(tokens, o);
  try {
    const out = layout(tokens, o, eol);
    if (sameTokens(tokens, tokenize(out))) return out;
  } catch {
    // fall through to keyword case only
  }
  return caseOnly(tokens, o);
}

function endsInLineComment(text: string): boolean {
  const tokens = tokenize(text).filter((t) => !isBlank(t));
  return tokens[tokens.length - 1]?.kind === 'lineComment';
}

function splitGap(gap: string): { term: string; rest: string } {
  const first = tokenize(gap).find((t) => !isBlank(t));
  if (first && (isPunct(first, ';') || first.kind === 'slash')) return { term: first.text, rest: gap.slice(first.to).trim() };
  return { term: '', rest: gap.trim() };
}

export function formatSql(text: string, options: SqlFormatOptions): string {
  const statements = splitStatements(text);
  if (statements.length === 0) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const separator = options.blankLineBetweenStatements ? eol + eol : eol;
  const parts = statements.map((s, k) => {
    const gapEnd = k + 1 < statements.length ? statements[k + 1]!.from : text.length;
    const { term, rest } = splitGap(text.slice(s.to, gapEnd));
    let piece = formatStatement(s.text, options, eol);
    if (term === ';') piece += endsInLineComment(s.text) ? eol + ';' : ';';
    else if (term === '/') piece += eol + '/';
    if (rest) piece += eol + rest;
    return piece;
  });
  return text.slice(0, statements[0]!.from) + parts.join(separator) + text.slice(text.trimEnd().length);
}
