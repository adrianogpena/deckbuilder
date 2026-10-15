import { isPlsqlStart, splitStatements } from './statements.ts';
import { tokenize, type Token } from './tokens.ts';

export type SqlStatementKind = 'select' | 'insert' | 'update' | 'delete' | 'merge' | 'create' | 'plsql' | 'other';
export type SqlJoinType = 'inner' | 'left' | 'right' | 'full' | 'cross' | 'comma' | 'apply';
export type SqlSetOp = 'union' | 'union all' | 'intersect' | 'minus' | 'except';

export interface SqlRead {
  name: string;
  alias?: string;
  cte: boolean;
  from: number;
  to: number;
}

export interface SqlJoin {
  type: SqlJoinType;
  target: string;
  alias?: string;
  on?: string;
}

export interface SqlStep {
  /** CTE name, or '' for the main query. */
  name: string;
  kind: 'cte' | 'main';
  from: number;
  to: number;
  nameFrom?: number;
  nameTo?: number;
  reads: SqlRead[];
  joins: SqlJoin[];
  filters: string[];
  groupBy: string[];
  aggregates: string[];
  having?: string;
  distinct: boolean;
  windows: string[];
  dedupe: boolean;
  setOps: SqlSetOp[];
  orderBy: string[];
  limit?: string;
  subqueries: number;
  /** Names of later steps ('main' for the main query) that read this CTE. */
  feeds: string[];
}

export interface SqlStatementOutline {
  from: number;
  to: number;
  kind: SqlStatementKind;
  target?: string;
  steps: SqlStep[];
}

export interface SqlOutline {
  statements: SqlStatementOutline[];
  /** Distinct base tables read anywhere, as first written. */
  tables: string[];
}

const TRIVIA = new Set(['whitespace', 'newline', 'lineComment', 'blockComment', 'slash']);
const MAX = 120;
const AGGREGATES = new Set([
  'sum', 'count', 'avg', 'min', 'max', 'listagg', 'stddev', 'variance', 'median', 'string_agg', 'array_agg',
  'collect', 'xmlagg', 'json_arrayagg', 'json_objectagg', 'group_concat', 'stats_mode', 'approx_count_distinct',
]);
const RANKING = new Set(['row_number', 'rank', 'dense_rank']);
const SET_OPS = new Set(['union', 'intersect', 'minus', 'except']);
const JOIN_WORDS = new Set(['inner', 'left', 'right', 'full', 'cross', 'natural', 'outer', 'join', 'apply']);
const OTHER_BOUNDARY = new Set([
  'set', 'values', 'returning', 'into', 'for', 'model', 'pivot', 'unpivot', 'insert', 'update', 'delete', 'when',
  'then', 'merge',
]);
const RESERVED = new Set([
  'select', 'from', 'where', 'group', 'order', 'having', 'union', 'intersect', 'minus', 'except', 'fetch', 'offset',
  'limit', 'connect', 'start', 'join', 'inner', 'left', 'right', 'full', 'cross', 'natural', 'outer', 'apply', 'on',
  'using', 'as', 'with', 'lateral', 'partition', 'pivot', 'unpivot', 'sample', 'model', 'for', 'when', 'then', 'set',
  'into', 'values', 'returning', 'and', 'or', 'not', 'case', 'end', 'is', 'in', 'by', 'null', 'over', 'window',
  'distinct', 'unique', 'all', 'cycle', 'search', 'insert', 'update', 'delete', 'merge',
]);
const QUERY_START = new Set(['select', 'with']);

interface Ctx {
  ts: Token[];
  match: Int32Array;
  ctes: Set<string>;
}

interface Extra {
  rank: boolean;
  aliases: Set<string>;
}

type SecKind = 'where' | 'mergeOn' | 'group' | 'order' | 'having' | 'on' | 'limit';
interface Sec {
  kind: SecKind;
  start: number;
  splits: number[];
}

const isWordTok = (t: Token | undefined): boolean => t !== undefined && (t.kind === 'keyword' || t.kind === 'identifier');
const word = (ctx: Ctx, i: number): string => {
  const t = ctx.ts[i];
  return t !== undefined && isWordTok(t) ? t.text.toLowerCase() : '';
};
const isPunct = (ctx: Ctx, i: number, c: string): boolean => {
  const t = ctx.ts[i];
  return t !== undefined && t.kind === 'punctuation' && t.text === c;
};
const nameKey = (name: string): string => name.replace(/"/g, '').toLowerCase();
const cap = (s: string): string => (s.length > MAX ? s.slice(0, MAX - 1).trimEnd() + '…' : s);

function textOf(ctx: Ctx, a: number, b: number): string {
  let out = '';
  for (let k = a; k < b && k < ctx.ts.length; k++) {
    const t = ctx.ts[k]!;
    if (k > a && t.from > ctx.ts[k - 1]!.to) out += ' ';
    out += t.text.replace(/\s+/g, ' ');
    if (out.length > MAX) break;
  }
  return cap(out.trim());
}

function closeOf(ctx: Ctx, i: number, b: number): number {
  const m = ctx.match[i] ?? -1;
  return m >= 0 && m < b ? m : b;
}

function isNameTok(ctx: Ctx, i: number, b: number): boolean {
  if (i >= b) return false;
  const t = ctx.ts[i]!;
  if (t.kind === 'quotedIdentifier') return true;
  return isWordTok(t) && !RESERVED.has(t.text.toLowerCase());
}

const isPartTok = (ctx: Ctx, i: number, b: number): boolean =>
  i < b && (isWordTok(ctx.ts[i]) || ctx.ts[i]!.kind === 'quotedIdentifier');

function parseName(ctx: Ctx, i: number, b: number): { name: string; from: number; to: number; next: number } | null {
  if (!isNameTok(ctx, i, b)) return null;
  let j = i;
  while (isPunct(ctx, j + 1, '.') && isPartTok(ctx, j + 2, b)) j += 2;
  if (isPunct(ctx, j + 1, '@') && isPartTok(ctx, j + 2, b)) {
    j += 2;
    while (isPunct(ctx, j + 1, '.') && isPartTok(ctx, j + 2, b)) j += 2;
  }
  let name = '';
  for (let k = i; k <= j; k++) name += ctx.ts[k]!.text;
  return { name, from: ctx.ts[i]!.from, to: ctx.ts[j]!.to, next: j + 1 };
}

function parseAlias(ctx: Ctx, k: number, b: number): { alias?: string; next: number } {
  if (word(ctx, k) === 'as') {
    return isNameTok(ctx, k + 1, b) ? { alias: ctx.ts[k + 1]!.text, next: k + 2 } : { next: k + 1 };
  }
  return isNameTok(ctx, k, b) ? { alias: ctx.ts[k]!.text, next: k + 1 } : { next: k };
}

function newStep(name: string, kind: 'cte' | 'main', from: number, to: number): SqlStep {
  return {
    name, kind, from, to, reads: [], joins: [], filters: [], groupBy: [], aggregates: [], distinct: false,
    windows: [], dedupe: false, setOps: [], orderBy: [], subqueries: 0, feeds: [],
  };
}

function analyze(ctx: Ctx, a: number, b: number, step: SqlStep, extra: Extra, startClause = 'select'): void {
  let clause = startClause;
  let sec: Sec | null = null;
  let d = 0;
  let caseDepth = 0;
  let between = false;
  let expectItem = false;
  let joinPending: SqlJoinType | null = null;
  let joinWords: string[] = [];
  let lastJoin: SqlJoin | null = null;

  const pieces = (s: Sec, end: number): string[] => {
    const out: string[] = [];
    let from = s.start;
    for (const sp of [...s.splits, end]) {
      if (sp > from) {
        const p = textOf(ctx, from, sp);
        if (p) out.push(p);
      }
      from = sp + 1;
    }
    return out;
  };

  const close = (end: number): void => {
    if (!sec) return;
    const s = sec;
    sec = null;
    between = false;
    if (s.kind === 'where' || s.kind === 'mergeOn') {
      for (const p of pieces(s, end)) {
        step.filters.push(p);
        if (step.limit === undefined && /\brownum\b/i.test(p)) step.limit = p;
      }
    } else if (s.kind === 'group') step.groupBy.push(...pieces(s, end));
    else if (s.kind === 'order') step.orderBy.push(...pieces(s, end));
    else {
      const t = textOf(ctx, s.start, end);
      if (!t) return;
      if (s.kind === 'having') step.having = t;
      else if (s.kind === 'limit') step.limit = t;
      else if (lastJoin) lastJoin.on = t;
    }
  };

  const open = (kind: SecKind, at: number, start: number): void => {
    close(at);
    sec = { kind, start, splits: [] };
  };

  const addItem = (name: string, alias: string | undefined, from: number, to: number, base: boolean): void => {
    if (base) {
      const cte = !/[.@]/.test(name.replace(/"[^"]*"/g, 'x')) && ctx.ctes.has(nameKey(name));
      const read: SqlRead = { name, cte, from, to };
      if (alias) read.alias = alias;
      step.reads.push(read);
    }
    if (joinPending) {
      const j: SqlJoin = { type: joinPending, target: name };
      if (alias) j.alias = alias;
      step.joins.push(j);
      lastJoin = j;
    } else lastJoin = null;
    joinPending = null;
    joinWords = [];
    expectItem = false;
  };

  const inner = (from: number, to: number): void => {
    const sub = newStep('', 'main', 0, 0);
    const subExtra: Extra = { rank: false, aliases: new Set() };
    analyze(ctx, from, to, sub, subExtra);
    step.reads.push(...sub.reads);
    step.windows.push(...sub.windows);
    step.subqueries += sub.subqueries;
    if (subExtra.rank) extra.rank = true;
    for (const x of subExtra.aliases) extra.aliases.add(x);
  };

  for (let i = a; i < b; i++) {
    const t = ctx.ts[i]!;
    if (t.kind === 'punctuation' && t.text === '(') {
      const c = closeOf(ctx, i, b);
      if (QUERY_START.has(word(ctx, i + 1))) {
        step.subqueries++;
        inner(i + 1, c);
        if (expectItem) {
          const al = parseAlias(ctx, c + 1, b);
          addItem('(subquery)', al.alias, 0, 0, false);
          i = al.next - 1;
        } else i = c;
        continue;
      }
      d++;
      continue;
    }
    if (t.kind === 'punctuation' && t.text === ')') {
      if (d > 0) d--;
      continue;
    }
    const lw = word(ctx, i);
    if (expectItem) {
      if (lw === 'lateral' || lw === 'only') continue;
      const n = parseName(ctx, i, b);
      if (n) {
        if (isPunct(ctx, n.next, '(')) {
          const c = closeOf(ctx, n.next, b);
          const al = parseAlias(ctx, c + 1, b);
          addItem(textOf(ctx, i, c + 1), al.alias, 0, 0, false);
          i = al.next - 1;
          continue;
        }
        const al = parseAlias(ctx, n.next, b);
        addItem(n.name, al.alias, n.from, n.to, true);
        i = al.next - 1;
        continue;
      }
      expectItem = false;
    }
    if (lw && isPunct(ctx, i + 1, '(')) {
      const c = closeOf(ctx, i + 1, b);
      if (word(ctx, c + 1) === 'over') {
        let end = c + 2;
        if (isPunct(ctx, c + 2, '(')) end = closeOf(ctx, c + 2, b) + 1;
        else if (c + 2 < b) end = c + 3;
        end = Math.min(end, b);
        step.windows.push(textOf(ctx, i, end));
        if (RANKING.has(lw)) {
          extra.rank = true;
          const al = parseAlias(ctx, end, b);
          if (al.alias) extra.aliases.add(nameKey(al.alias));
        }
        i = end - 1;
        continue;
      }
      if (AGGREGATES.has(lw)) {
        const agg = textOf(ctx, i, Math.min(c + 1, b));
        if (!step.aggregates.includes(agg)) step.aggregates.push(agg);
        i = c;
        continue;
      }
    }
    if (d > 0) continue;
    if (lw === 'case') {
      caseDepth++;
      continue;
    }
    if (caseDepth > 0) {
      if (lw === 'end') caseDepth--;
      continue;
    }
    if (t.kind === 'punctuation' && t.text === ',') {
      if (sec !== null && ((sec as Sec).kind === 'group' || (sec as Sec).kind === 'order')) (sec as Sec).splits.push(i);
      else if (clause === 'from') {
        close(i);
        joinPending = 'comma';
        expectItem = true;
      }
      continue;
    }
    if (!lw) continue;
    if (lw === 'and') {
      const s = sec as Sec | null;
      if (s && (s.kind === 'where' || s.kind === 'mergeOn')) {
        if (between) between = false;
        else s.splits.push(i);
      }
      continue;
    }
    if (lw === 'between') {
      between = true;
      continue;
    }
    if (lw === 'select') {
      close(i);
      clause = 'select';
      const nx = word(ctx, i + 1);
      if (nx === 'distinct' || nx === 'unique') {
        step.distinct = true;
        i++;
      }
      continue;
    }
    if (lw === 'from') {
      close(i);
      clause = 'from';
      expectItem = true;
      joinPending = null;
      lastJoin = null;
      continue;
    }
    if (lw === 'where') {
      open('where', i, i + 1);
      clause = 'where';
      continue;
    }
    if (lw === 'group' || lw === 'order') {
      let k = i + 1;
      if (word(ctx, k) === 'siblings') k++;
      if (word(ctx, k) === 'by') {
        open(lw, i, k + 1);
        clause = lw;
        i = k;
        continue;
      }
    }
    if (lw === 'having') {
      open('having', i, i + 1);
      clause = 'having';
      continue;
    }
    if (SET_OPS.has(lw)) {
      close(i);
      const nx = word(ctx, i + 1);
      let op = lw as SqlSetOp;
      if (lw === 'union' && nx === 'all') {
        op = 'union all';
        i++;
      } else if (nx === 'all' || nx === 'distinct') i++;
      step.setOps.push(op);
      clause = 'other';
      continue;
    }
    if (lw === 'fetch' || lw === 'limit' || lw === 'offset') {
      if ((sec as Sec | null)?.kind !== 'limit') open('limit', i, i);
      clause = 'limit';
      continue;
    }
    if ((lw === 'connect' && word(ctx, i + 1) === 'by') || (lw === 'start' && word(ctx, i + 1) === 'with')) {
      close(i);
      clause = 'other';
      i++;
      continue;
    }
    if (clause === 'from' && JOIN_WORDS.has(lw) && !isPunct(ctx, i + 1, '(')) {
      close(i);
      if (lw === 'join' || lw === 'apply') {
        joinPending =
          lw === 'apply' ? 'apply'
          : joinWords.includes('left') ? 'left'
          : joinWords.includes('right') ? 'right'
          : joinWords.includes('full') ? 'full'
          : joinWords.includes('cross') ? 'cross'
          : 'inner';
        joinWords = [];
        expectItem = true;
      } else joinWords.push(lw);
      continue;
    }
    if (lw === 'on' && clause === 'from') {
      open(lastJoin ? 'on' : 'mergeOn', i, i + 1);
      continue;
    }
    if (lw === 'using') {
      if (clause === 'from' && lastJoin) open('on', i, i);
      else {
        close(i);
        clause = 'from';
        expectItem = true;
        joinPending = null;
        lastJoin = null;
      }
      continue;
    }
    if (OTHER_BOUNDARY.has(lw)) {
      close(i);
      clause = 'other';
    }
  }
  close(b);
}

function findQuery(ctx: Ctx, j: number, b: number): number {
  let d = 0;
  for (let i = j; i < b; i++) {
    if (isPunct(ctx, i, '(')) {
      if (d === 0 && QUERY_START.has(word(ctx, i + 1))) return i + 1;
      d++;
    } else if (isPunct(ctx, i, ')')) {
      if (d > 0) d--;
    } else if (d === 0 && QUERY_START.has(word(ctx, i))) return i;
  }
  return -1;
}

const FIRST_ROW = [
  /^(?:[^\s.]+\.)?([^\s.=<>]+)\s*(?:=|<=)\s*1$/,
  /^(?:[^\s.]+\.)?([^\s.=<>]+)\s*<\s*2$/,
  /^1\s*(?:=|>=)\s*(?:[^\s.]+\.)?([^\s.=<>]+)$/,
];

function isFirstRowFilter(f: string, aliases: Set<string>): boolean {
  for (const re of FIRST_ROW) {
    const m = re.exec(f);
    if (m) return aliases.size === 0 || aliases.has(nameKey(m[1]!));
  }
  return false;
}

function outlineStatement(ctx: Ctx, from: number, to: number, plsql: boolean): SqlStatementOutline {
  const out: SqlStatementOutline = { from, to, kind: 'other', steps: [] };
  const n = ctx.ts.length;
  if (plsql) {
    out.kind = 'plsql';
    return out;
  }
  if (n === 0) return out;
  const steps: SqlStep[] = [];
  const extras = new Map<SqlStep, Extra>();

  const main = (a: number, fromIdx: number, clause: string): void => {
    if (a < 0 || a >= n) return;
    const step = newStep('', 'main', ctx.ts[fromIdx]!.from, ctx.ts[n - 1]!.to);
    const extra: Extra = { rank: false, aliases: new Set() };
    analyze(ctx, a, n, step, extra, clause);
    steps.push(step);
    extras.set(step, extra);
  };

  const withList = (i: number): number => {
    let j = i + 1;
    if (word(ctx, j) === 'recursive') j++;
    while (j < n) {
      if (!isPartTok(ctx, j, n) || RESERVED.has(word(ctx, j)) || word(ctx, j) === 'function' || word(ctx, j) === 'procedure') break;
      const nameIdx = j;
      j++;
      if (isPunct(ctx, j, '(')) j = closeOf(ctx, j, n) + 1;
      if (word(ctx, j) !== 'as') break;
      j++;
      if (word(ctx, j) === 'not') j++;
      if (word(ctx, j) === 'materialized') j++;
      if (!isPunct(ctx, j, '(')) break;
      const c = closeOf(ctx, j, n);
      const nameTok = ctx.ts[nameIdx]!;
      ctx.ctes.add(nameKey(nameTok.text));
      const step = newStep(nameTok.text, 'cte', nameTok.from, (ctx.ts[c] ?? ctx.ts[n - 1]!).to);
      step.nameFrom = nameTok.from;
      step.nameTo = nameTok.to;
      const extra: Extra = { rank: false, aliases: new Set() };
      analyze(ctx, j + 1, c, step, extra);
      steps.push(step);
      extras.set(step, extra);
      j = c + 1;
      while (j < n && !isPunct(ctx, j, ',') && !isPunct(ctx, j, '(') && !QUERY_START.has(word(ctx, j)) &&
        !['insert', 'update', 'delete', 'merge'].includes(word(ctx, j))) j++;
      if (isPunct(ctx, j, ',')) {
        j++;
        continue;
      }
      break;
    }
    return j;
  };

  const query = (q: number): void => {
    if (q < 0) return;
    const start = word(ctx, q) === 'with' ? withList(q) : q;
    main(start, q, 'select');
  };

  let i = 0;
  if (word(ctx, 0) === 'with') i = withList(0);
  const w = word(ctx, i);
  if (w === 'select' || isPunct(ctx, i, '(')) {
    out.kind = 'select';
    main(i, i, 'select');
  } else if (w === 'insert') {
    out.kind = 'insert';
    let j = i + 1;
    if (word(ctx, j) === 'into') j++;
    const t = word(ctx, j) === 'all' || word(ctx, j) === 'first' ? null : parseName(ctx, j, n);
    if (t) out.target = t.name;
    query(findQuery(ctx, t ? t.next : j, n));
  } else if (w === 'update' || w === 'delete' || w === 'merge') {
    out.kind = w;
    let j = i + 1;
    if ((w === 'delete' && word(ctx, j) === 'from') || (w === 'merge' && word(ctx, j) === 'into')) j++;
    const t = parseName(ctx, j, n);
    if (t) out.target = t.name;
    main(t ? t.next : j, i, 'other');
  } else if (w === 'create') {
    out.kind = 'create';
    for (let j = i + 1; j < Math.min(n, i + 10); j++) {
      const k = word(ctx, j);
      if (k === 'table' || k === 'view' || k === 'index' || k === 'sequence' || k === 'synonym') {
        const t = parseName(ctx, j + 1, n);
        if (t) out.target = t.name;
        if ((k === 'table' || k === 'view') && t) query(findQuery(ctx, t.next, n));
        break;
      }
    }
  }

  for (const s of steps) {
    if (s.kind !== 'cte') continue;
    const key = nameKey(s.name);
    for (const o of steps) {
      if (o === s || !o.reads.some((r) => r.cte && nameKey(r.name) === key)) continue;
      const label = o.kind === 'main' ? 'main' : o.name;
      if (!s.feeds.includes(label)) s.feeds.push(label);
    }
  }
  for (const s of steps) {
    const ex = extras.get(s)!;
    if (!ex.rank) continue;
    const cands = [...s.filters];
    if (s.kind === 'cte') {
      const key = nameKey(s.name);
      for (const o of steps) if (o !== s && o.reads.some((r) => r.cte && nameKey(r.name) === key)) cands.push(...o.filters);
    }
    s.dedupe = cands.some((f) => isFirstRowFilter(f, ex.aliases));
  }
  out.steps = steps;
  return out;
}

function matchParens(ts: Token[]): Int32Array {
  const match = new Int32Array(ts.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!;
    if (t.kind !== 'punctuation') continue;
    if (t.text === '(') stack.push(i);
    else if (t.text === ')' && stack.length) {
      const o = stack.pop()!;
      match[o] = i;
      match[i] = o;
    }
  }
  return match;
}

/** Explains SQL text as statements made of ordered steps (CTEs, then the main query). Never throws. */
export function sqlOutline(text: string): SqlOutline {
  const statements: SqlStatementOutline[] = [];
  const tables: string[] = [];
  let all: Token[];
  let parts: ReturnType<typeof splitStatements>;
  try {
    all = tokenize(text);
    parts = splitStatements(text);
  } catch {
    return { statements, tables };
  }
  const seen = new Set<string>();
  let k = 0;
  for (const s of parts) {
    while (k < all.length && all[k]!.from < s.from) k++;
    const first = k;
    const ts: Token[] = [];
    while (k < all.length && all[k]!.to <= s.to) {
      if (!TRIVIA.has(all[k]!.kind)) ts.push(all[k]!);
      k++;
    }
    let outline: SqlStatementOutline;
    try {
      const ctx: Ctx = { ts, match: matchParens(ts), ctes: new Set() };
      outline = outlineStatement(ctx, s.from, s.to, isPlsqlStart(all, first));
    } catch {
      outline = { from: s.from, to: s.to, kind: 'other', steps: [] };
    }
    statements.push(outline);
    for (const step of outline.steps) {
      for (const r of step.reads) {
        if (r.cte) continue;
        const key = nameKey(r.name);
        if (seen.has(key)) continue;
        seen.add(key);
        tables.push(r.name);
      }
    }
  }
  return { statements, tables };
}
