import {
  isNameTok,
  isPunct,
  matchParens,
  nameKey,
  parseAlias,
  parseName,
  sqlOutline,
  word,
  type Ctx,
  type SqlJoinType,
  type SqlOutline,
  type SqlStatementOutline,
} from './outline.ts';
import { sqlMarkers, sqlParams } from './markers.ts';
import { isPlsqlStart } from './statements.ts';
import { tokenize, type Token } from './tokens.ts';

export type SqlLintCode =
  | 'nullCompare'
  | 'notInNullable'
  | 'leftJoinUndone'
  | 'unusedCte'
  | 'duplicateCte'
  | 'duplicateAlias'
  | 'unbalancedParens'
  | 'unionDistinct'
  | 'selectStar'
  | 'cartesianJoin'
  | 'paramOnlyInCondition'
  | 'markerFragmentNoParam'
  | 'paramGap'
  | 'unguardedIn'
  | 'markerUnterminated'
  | 'markerNoFragment'
  | 'setColumnCount'
  | 'rownumOrder'
  | 'fetchNoOrder'
  | 'constantCondition'
  | 'unusedOuterJoin'
  | 'unknownAlias'
  | 'duplicateColumn'
  | 'distinctGroupBy'
  | 'distinctParens'
  | 'emptyStatement'
  | 'emptyStringCompare'
  | 'rownumNever'
  | 'mixedJoinSyntax';

export type SqlLintSeverity = 'error' | 'warning' | 'info';

export interface SqlProblem {
  code: SqlLintCode;
  severity: SqlLintSeverity;
  from: number;
  to: number;
  /** Values for the i18n message, e.g. {name} or {alias}. */
  params?: Record<string, string>;
  /** CTE name, or '' for the main query, when the problem sits inside a step. */
  step?: string;
  /** Index of the statement in the outline. */
  statement: number;
}

export const SQL_LINT_SEVERITY: Readonly<Record<SqlLintCode, SqlLintSeverity>> = {
  nullCompare: 'error',
  notInNullable: 'warning',
  leftJoinUndone: 'warning',
  unusedCte: 'warning',
  duplicateCte: 'error',
  duplicateAlias: 'error',
  unbalancedParens: 'error',
  unionDistinct: 'info',
  selectStar: 'info',
  cartesianJoin: 'warning',
  paramOnlyInCondition: 'warning',
  markerFragmentNoParam: 'warning',
  paramGap: 'info',
  unguardedIn: 'warning',
  markerUnterminated: 'warning',
  markerNoFragment: 'warning',
  setColumnCount: 'error',
  rownumOrder: 'warning',
  fetchNoOrder: 'warning',
  constantCondition: 'warning',
  unusedOuterJoin: 'warning',
  unknownAlias: 'error',
  duplicateColumn: 'warning',
  distinctGroupBy: 'info',
  distinctParens: 'info',
  emptyStatement: 'info',
  emptyStringCompare: 'error',
  rownumNever: 'error',
  mixedJoinSyntax: 'error',
};

const TRIVIA = new Set(['whitespace', 'newline', 'lineComment', 'blockComment', 'slash']);
const QUERY_START = new Set(['select', 'with']);
const COMPARE = new Set(['=', '<>', '!=', '^=', '~=']);
const NULL_SAFE = new Set(['nvl', 'nvl2', 'coalesce', 'decode', 'isnull', 'ifnull']);
const JOIN_WORDS = new Set(['inner', 'left', 'right', 'full', 'cross', 'natural', 'outer', 'join', 'apply']);
const STAR_BEFORE = new Set(['select', 'distinct', 'unique', 'all']);
const NOT_COLUMN = new Set([
  'sysdate', 'systimestamp', 'current_date', 'current_timestamp', 'localtimestamp', 'rownum', 'rowid', 'level',
  'user', 'true', 'false', 'date', 'timestamp', 'interval', 'like', 'escape', 'exists', 'prior',
]);
const NOT_BARE = new Set([
  'else', 'asc', 'desc', 'nulls', 'first', 'last', 'between', 'rows', 'row', 'only', 'next', 'siblings', 'any', 'some',
  'ties', 'percent', 'within', 'keep', 'nocycle', 'day', 'month', 'year', 'hour', 'minute', 'second', 'to',
]);
const NOT_ALIAS_AFTER = new Set(['prior', 'connect_by_root', 'date', 'timestamp', 'interval', 'distinct', 'unique', 'all']);
const SET_OPS = new Set(['union', 'intersect', 'minus', 'except']);
const CMP_ALL = new Set(['=', '<>', '!=', '^=', '~=', '>=', '<=', '>', '<']);
const FLIP: Record<string, string> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '=': '=' };
const ANSI_JOIN = new Set<ItemJoin>(['inner', 'left', 'right', 'full', 'cross']);
const PSEUDO_PREFIX = /^(sys|sys_\w*|dbms_\w*|utl_\w*|apex_\w*|owa_\w*|htp|htf|ctx_\w*|mdsys|xdb|public|new|old|standard)$|pkg|pck|pack/;

type ItemJoin = SqlJoinType | 'first';
interface Item {
  join: ItemJoin;
  key: string;
  table: string;
  label: string;
  from: number;
  to: number;
  keyFrom: number;
  keyTo: number;
  complex: boolean;
}
interface Block {
  items: Item[];
  where: Array<[number, number]>;
  ons: Array<[number, number, number]>;
  unsure: boolean;
  start: number;
  end: number;
  selFrom: number;
  selTo: number;
  distinct: number;
  group: boolean;
  order: boolean;
  fetch: number[];
  parent: Block | null;
  named: boolean;
  first: boolean;
}
interface Frame {
  own: boolean;
  block: Block | null;
  parent: Block | null;
  named: boolean;
  setOp: number;
  clause: string;
  expect: boolean;
  pending: ItemJoin | null;
  joinWords: string[];
  sec: 'where' | 'on' | null;
  secStart: number;
  set: boolean;
  exists: boolean;
  derived: boolean;
}
interface Star {
  from: number;
  to: number;
  exists: boolean;
}
type Emit = (code: SqlLintCode, from: number, to: number, params?: Record<string, string>) => void;

interface Ref {
  key: string;
  text: string;
  wrapped: boolean;
  branch: number;
}
interface Conj {
  from: number;
  to: number;
  refs: Ref[];
  bare: number;
  branches: number;
  isNull: boolean;
  hasCase: boolean;
  plus: boolean;
  hasSub: boolean;
}

const isNameLike = (t: Token | undefined): boolean =>
  t !== undefined && (t.kind === 'identifier' || t.kind === 'keyword' || t.kind === 'quotedIdentifier');

function closeAt(ctx: Ctx, i: number): number {
  const m = ctx.match[i] ?? -1;
  return m > i ? m : ctx.ts.length - 1;
}

function operandStart(ctx: Ctx, k: number): number {
  const { ts, match } = ctx;
  if (k < 0) return ts[0]!.from;
  if (isPunct(ctx, k, ')') && (match[k] ?? -1) >= 0) {
    k = match[k]!;
    if (isNameLike(ts[k - 1])) k--;
  }
  while (k >= 2 && isPunct(ctx, k - 1, '.') && isNameLike(ts[k - 2])) k -= 2;
  return ts[k]!.from;
}

function operandEnd(ctx: Ctx, k: number): number {
  const { ts } = ctx;
  if (k >= ts.length) return ts[ts.length - 1]!.to;
  if (isPunct(ctx, k, '(')) return ts[closeAt(ctx, k)]!.to;
  while (isPunct(ctx, k + 1, '.') && isNameLike(ts[k + 2])) k += 2;
  if (isPunct(ctx, k + 1, '(')) k = closeAt(ctx, k + 1);
  return ts[k]!.to;
}

interface Scan {
  blocks: Block[];
  stars: Star[];
  owner: Array<Block | null>;
  setOps: Array<[Block, number, Block]>;
}

function scan(ctx: Ctx, emit: Emit): Scan {
  const { ts, match } = ctx;
  const n = ts.length;
  const blocks: Block[] = [];
  const stars: Star[] = [];
  const owner: Array<Block | null> = new Array<Block | null>(n).fill(null);
  const setOps: Array<[Block, number, Block]> = [];
  const frame = (own: boolean, block: Block | null, exists = false, derived = false, parent: Block | null = null, named = false): Frame => ({
    own, block, parent, named, setOp: -1, clause: 'other', expect: false, pending: null, joinWords: [], sec: null, secStart: 0,
    set: false, exists, derived,
  });
  const stack: Frame[] = [frame(true, null)];

  const closeSec = (f: Frame, at: number): void => {
    if (f.sec && f.block && at > f.secStart) {
      if (f.sec === 'where') f.block.where.push([f.secStart, at]);
      else f.block.ons.push([f.block.items.length - 1, f.secStart, at]);
    }
    f.sec = null;
  };
  const closeSel = (f: Frame, at: number): void => {
    if (f.block && f.clause === 'select' && f.block.selTo < 0) f.block.selTo = at;
  };
  const addItem = (
    f: Frame, keyText: string, from: number, to: number, keyFrom: number, keyTo: number, complex: boolean, table = '',
  ): void => {
    f.block!.items.push({
      join: f.pending ?? 'first', key: keyText ? nameKey(keyText) : '', table: table ? nameKey(table) : '', label: keyText,
      from, to, keyFrom, keyTo, complex,
    });
    f.pending = null;
    f.expect = false;
    f.joinWords = [];
  };

  for (let i = 0; i < n; i++) {
    const t = ts[i]!;
    const f = stack[stack.length - 1]!;
    owner[i] = f.block;
    if (t.kind === 'punctuation' && t.text === '(') {
      if (QUERY_START.has(word(ctx, i + 1))) {
        const derived = f.own && f.expect && f.block !== null;
        const named = derived || (word(ctx, i - 1) === 'as' && !isPunct(ctx, i - 2, ')'));
        stack.push(frame(true, null, word(ctx, i - 1) === 'exists', derived, f.block, named));
      } else {
        if (f.own && f.expect && f.block) {
          f.block.unsure = true;
          f.expect = false;
        }
        stack.push(frame(false, f.block, false, false, f.parent));
      }
      continue;
    }
    if (t.kind === 'punctuation' && t.text === ')') {
      if (stack.length === 1) continue;
      closeSec(f, i);
      closeSel(f, i);
      stack.pop();
      const p = stack[stack.length - 1]!;
      if (f.derived && p.block) {
        const al = parseAlias(ctx, i + 1, n);
        const open = ts[match[i]! >= 0 ? match[i]! : i]!;
        const aliasTok = al.alias ? ts[al.next - 1]! : t;
        addItem(p, al.alias ?? '', open.from, aliasTok.to, aliasTok.from, aliasTok.to, true);
        i = al.next - 1;
      }
      continue;
    }
    if (t.kind === 'operator') {
      if (COMPARE.has(t.text) && !f.set) {
        if (word(ctx, i + 1) === 'null' && i > 0) emit('nullCompare', operandStart(ctx, i - 1), ts[i + 1]!.to);
        else if (word(ctx, i - 1) === 'null') emit('nullCompare', ts[i - 1]!.from, operandEnd(ctx, i + 1));
        else if (ts[i + 1]?.kind === 'string' && ts[i + 1]!.text === "''" && i > 0) {
          emit('emptyStringCompare', operandStart(ctx, i - 1), ts[i + 1]!.to);
        } else if (ts[i - 1]?.kind === 'string' && ts[i - 1]!.text === "''") {
          emit('emptyStringCompare', ts[i - 1]!.from, operandEnd(ctx, i + 1));
        }
      } else if (t.text === '*' && f.own && f.block && f.clause === 'select') {
        const pv = ts[i - 1];
        if (pv && ((pv.kind === 'punctuation' && (pv.text === ',' || pv.text === '.')) || STAR_BEFORE.has(word(ctx, i - 1)))) {
          stars.push({ from: t.from, to: t.to, exists: f.exists });
        }
      }
      continue;
    }
    const lw = word(ctx, i);
    if (lw === 'not' && word(ctx, i + 1) === 'in' && isPunct(ctx, i + 2, '(') && QUERY_START.has(word(ctx, i + 3))) {
      emit('notInNullable', t.from, ts[i + 1]!.to);
    }
    if (lw === 'union' && word(ctx, i + 1) !== 'all') emit('unionDistinct', t.from, t.to);
    if (!f.own) continue;
    if (f.expect && f.block) {
      if (lw === 'lateral' || lw === 'only') continue;
      const nm = parseName(ctx, i, n);
      if (nm) {
        if (isPunct(ctx, nm.next, '(')) {
          const c = closeAt(ctx, nm.next);
          const al = parseAlias(ctx, c + 1, n);
          const end = al.alias ? ts[al.next - 1]! : ts[c]!;
          addItem(f, al.alias ?? '', nm.from, end.to, end.from, end.to, true);
          i = al.next - 1;
          continue;
        }
        const al = parseAlias(ctx, nm.next, n);
        const last = nm.name.replace(/@.*$/, '').split('.').pop() ?? nm.name;
        if (al.alias) {
          const at = ts[al.next - 1]!;
          addItem(f, al.alias, nm.from, at.to, at.from, at.to, false, last);
        } else {
          addItem(f, last, nm.from, nm.to, nm.from, nm.to, false, last);
        }
        i = al.next - 1;
        continue;
      }
      f.expect = false;
    }
    if (t.kind === 'punctuation' && t.text === ',') {
      if (f.block && f.clause === 'from') {
        closeSec(f, i);
        f.pending = 'comma';
        f.expect = true;
      }
      continue;
    }
    if (!lw) continue;
    if (lw === 'set') {
      f.set = true;
      continue;
    }
    if (lw === 'where' || lw === 'when' || lw === 'returning') f.set = false;
    if (lw === 'select') {
      closeSec(f, i);
      closeSel(f, i);
      const w1 = word(ctx, i + 1);
      const dist = w1 === 'distinct' || w1 === 'unique';
      const blk: Block = {
        items: [], where: [], ons: [], unsure: false, start: i, end: i, selFrom: dist || w1 === 'all' ? i + 2 : i + 1, selTo: -1,
        distinct: dist ? i + 1 : -1, group: false, order: false, fetch: [], parent: f.parent, named: f.named, first: !f.block,
      };
      if (f.block && f.setOp >= 0) setOps.push([f.block, f.setOp, blk]);
      f.setOp = -1;
      blocks.push(blk);
      f.block = blk;
      f.clause = 'select';
      f.expect = false;
      continue;
    }
    if (!f.block) continue;
    if (lw === 'from') {
      if (f.clause === 'select') {
        closeSec(f, i);
        closeSel(f, i);
        f.clause = 'from';
        f.expect = true;
        f.pending = null;
      }
      continue;
    }
    if (lw === 'where') {
      closeSec(f, i);
      f.sec = 'where';
      f.secStart = i + 1;
      f.clause = 'where';
      continue;
    }
    if (f.clause === 'from' && JOIN_WORDS.has(lw)) {
      closeSec(f, i);
      if (lw === 'join' || lw === 'apply') {
        const w = f.joinWords;
        f.pending =
          lw === 'apply' ? 'apply'
          : w.includes('left') ? 'left'
          : w.includes('right') ? 'right'
          : w.includes('full') ? 'full'
          : w.includes('cross') ? 'cross'
          : 'inner';
        f.joinWords = [];
        f.expect = true;
      } else f.joinWords.push(lw);
      continue;
    }
    if (f.clause === 'from' && lw === 'on') {
      closeSec(f, i);
      f.sec = 'on';
      f.secStart = i + 1;
      continue;
    }
    const nx = word(ctx, i + 1);
    if (
      ((lw === 'group' || lw === 'order') && (nx === 'by' || nx === 'siblings')) ||
      (lw === 'connect' && nx === 'by') || (lw === 'start' && nx === 'with') || (lw === 'for' && nx === 'update') ||
      lw === 'having' || lw === 'union' || lw === 'intersect' || lw === 'minus' || lw === 'except' ||
      lw === 'fetch' || lw === 'offset' || lw === 'limit' || lw === 'model' || lw === 'window' || lw === 'returning' ||
      lw === 'using' || lw === 'pivot' || lw === 'unpivot'
    ) {
      closeSec(f, i);
      if (lw === 'using' && f.clause === 'from') continue;
      closeSel(f, i);
      if (lw === 'group') f.block.group = true;
      else if (lw === 'order') f.block.order = true;
      else if (SET_OPS.has(lw)) f.setOp = i;
      else if ((lw === 'fetch' && (nx === 'first' || nx === 'next')) || (lw === 'offset' && /^rows?$/.test(word(ctx, i + 2)))) {
        f.block.fetch.push(i);
      }
      f.clause = 'other';
      f.expect = false;
    }
  }
  for (const f of stack) {
    closeSec(f, n);
    closeSel(f, n);
  }
  owner.forEach((b, k) => {
    if (b) b.end = k;
  });
  return { blocks, stars, owner, setOps };
}

function splitTop(ctx: Ctx, a: number, b: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = a;
  let d = 0;
  for (let k = a; k < b; k++) {
    if (isPunct(ctx, k, '(')) d++;
    else if (isPunct(ctx, k, ')')) d--;
    else if (d === 0 && isPunct(ctx, k, ',')) {
      out.push([start, k]);
      start = k + 1;
    }
  }
  if (b > start) out.push([start, b]);
  return out;
}

const selectItems = (ctx: Ctx, blk: Block): Array<[number, number]> =>
  blk.selTo > blk.selFrom ? splitTop(ctx, blk.selFrom, blk.selTo) : [];

const isStarItem = (ctx: Ctx, b: number): boolean => ctx.ts[b - 1]?.kind === 'operator' && ctx.ts[b - 1]!.text === '*';

function chainEnd(ctx: Ctx, k: number): number {
  if (!isNameLike(ctx.ts[k])) return -1;
  while (isPunct(ctx, k + 1, '.') && isNameLike(ctx.ts[k + 2])) k += 2;
  return k;
}

/** Output name token of a select item, and whether it is an alias. */
function outName(ctx: Ctx, a: number, b: number): { k: number; alias: boolean } | null {
  const { ts } = ctx;
  if (b - a >= 3 && word(ctx, b - 2) === 'as' && isNameLike(ts[b - 1])) return { k: b - 1, alias: true };
  if (b - a >= 2 && isNameTok(ctx, b - 1, b) && !NOT_BARE.has(word(ctx, b - 1))) {
    const p = ts[b - 2]!;
    const ok =
      (p.kind === 'punctuation' && p.text === ')') || p.kind === 'number' || p.kind === 'string' ||
      (isNameLike(p) && !NOT_ALIAS_AFTER.has(word(ctx, b - 2)) && (p.kind === 'quotedIdentifier' || isNameTok(ctx, b - 2, b)));
    if (ok) return { k: b - 1, alias: true };
  }
  return chainEnd(ctx, a) === b - 1 ? { k: b - 1, alias: false } : null;
}

function strip(ctx: Ctx, a: number, b: number): [number, number] {
  while (b - a > 1 && isPunct(ctx, a, '(') && ctx.match[a] === b - 1) {
    a++;
    b--;
  }
  return [a, b];
}

function findPlus(ctx: Ctx, a: number, b: number): number {
  for (let k = a; k < b; k++) {
    if (!isPunct(ctx, k, '(')) continue;
    if (QUERY_START.has(word(ctx, k + 1))) k = closeAt(ctx, k);
    else if (ctx.ts[k + 1]?.text === '+' && isPunct(ctx, k + 2, ')')) return k;
  }
  return -1;
}

interface Shared {
  inSpan: (pos: number) => boolean;
  aliasIdx: Set<number>;
}

function checkMore(ctx: Ctx, blk: Block, sh: Shared, emit: Emit): void {
  const { ts } = ctx;
  const n = ts.length;
  const { items } = blk;
  const sel = selectItems(ctx, blk);
  if (blk.distinct >= 0) {
    if (blk.group) emit('distinctGroupBy', ts[blk.distinct]!.from, ts[blk.distinct]!.to);
    if (isPunct(ctx, blk.distinct + 1, '(') && sel.length > 1) {
      emit('distinctParens', ts[blk.distinct]!.from, ts[closeAt(ctx, blk.distinct + 1)]!.to);
    }
  }
  if (!blk.order) for (const k of blk.fetch) emit('fetchNoOrder', ts[k]!.from, ts[k]!.to);
  if (blk.named && blk.first) {
    const seen = new Set<string>();
    for (const [a, b] of sel) {
      const o = outName(ctx, a, b);
      if (!o) continue;
      const key = nameKey(ts[o.k]!.text);
      if (seen.has(key)) emit('duplicateColumn', ts[o.k]!.from, ts[o.k]!.to, { name: ts[o.k]!.text });
      seen.add(key);
    }
  }

  const where = blk.where.flatMap(([a, b]) => conjuncts(ctx, a, b));
  for (const [a0, b0] of where) {
    const [a, b] = strip(ctx, a0, b0);
    const span = (): [number, number] => [ts[a]!.from, ts[b - 1]!.to];
    if (b - a < 3) continue;
    const head = word(ctx, a) === 'rownum';
    const tail = word(ctx, b - 1) === 'rownum';
    if (!head && !tail) continue;
    const opTok = ts[head ? a + 1 : b - 2]!;
    if (opTok.kind !== 'operator' || !FLIP[opTok.text]) continue;
    const op = head ? opTok.text : FLIP[opTok.text]!;
    if (blk.order && (op === '<' || op === '<=' || op === '=')) emit('rownumOrder', ...span());
    if (b - a !== 3) continue;
    const num = ts[head ? a + 2 : a]!;
    if (num.kind !== 'number') continue;
    const v = Number(num.text);
    if ((op === '>' && v >= 1) || ((op === '>=' || op === '=') && v > 1)) emit('rownumNever', ...span());
  }

  const conds = [...where, ...blk.ons.flatMap(([, a, b]) => conjuncts(ctx, a, b))];
  for (const [a0, b0] of conds) {
    const [a, b] = strip(ctx, a0, b0);
    if (!isNameTok(ctx, a, b) || NOT_COLUMN.has(word(ctx, a))) continue;
    const j = chainEnd(ctx, a);
    const op = ts[j + 1];
    if (!op || op.kind !== 'operator' || !CMP_ALL.has(op.text)) continue;
    if (!isNameTok(ctx, j + 2, b) || chainEnd(ctx, j + 2) !== b - 1 || b - 1 - (j + 2) !== j - a) continue;
    let same = true;
    for (let k = 0; k <= j - a && same; k++) same = nameKey(ts[a + k]!.text) === nameKey(ts[j + 2 + k]!.text);
    if (same) emit('constantCondition', ts[a]!.from, ts[b - 1]!.to);
  }

  if (items.some((it) => ANSI_JOIN.has(it.join))) {
    const ranges = [...blk.where, ...blk.ons.map(([, a, b]): [number, number] => [a, b])].sort((x, y) => x[0] - y[0]);
    for (const [a, b] of ranges) {
      const k = findPlus(ctx, a, b);
      if (k >= 0) {
        emit('mixedJoinSyntax', ts[k]!.from, ts[k + 2]!.to);
        break;
      }
    }
  }

  const outer = items.filter((it) => it.key && (it.join === 'left' || it.join === 'right' || it.join === 'full'));
  if (blk.unsure || outer.length === 0 || sel.some(([a, b]) => b - a === 1 && isStarItem(ctx, b))) return;
  for (let k = blk.start + 1; k <= blk.end; k++) {
    const w = word(ctx, k);
    if (
      (ts[k]!.kind === 'quotedIdentifier' || (isNameTok(ctx, k, n) && !NOT_COLUMN.has(w) && !NOT_BARE.has(w))) &&
      !isPunct(ctx, k - 1, '.') && !isPunct(ctx, k + 1, '.') && !isPunct(ctx, k + 1, '(') && word(ctx, k - 1) !== 'as' &&
      !sh.aliasIdx.has(k) && !sh.inSpan(ts[k]!.from)
    ) {
      return;
    }
  }
  for (const it of outer) {
    const k = items.indexOf(it);
    const own = blk.ons.filter((o) => o[0] === k);
    let used = false;
    for (let x = 0; x < n && !used; x++) {
      const t = ts[x]!;
      used =
        isNameLike(t) && isPunct(ctx, x + 1, '.') && nameKey(t.text) === it.key && !(t.from >= it.from && t.to <= it.to) &&
        !own.some(([, a, b]) => x >= a && x < b);
    }
    if (!used) emit('unusedOuterJoin', it.from, it.to, { alias: it.label });
  }
}

function checkAliases(ctx: Ctx, st: SqlStatementOutline, sc: Scan, sh: Shared, emit: Emit): void {
  if (st.kind !== 'select' && st.kind !== 'insert' && st.kind !== 'create') return;
  const { ts } = ctx;
  const ctes = new Set(st.steps.filter((s) => s.kind === 'cte').map((s) => nameKey(s.name)));
  ts.forEach((t, k) => {
    if (isNameLike(t) && word(ctx, k + 1) === 'as' && isPunct(ctx, k + 2, '(')) ctes.add(nameKey(t.text));
  });
  const scopes = new Map<Block, Set<string> | null>();
  const scope = (b: Block): Set<string> | null => {
    if (scopes.has(b)) return scopes.get(b)!;
    let s: Set<string> | null = null;
    if (!b.unsure) {
      const up = b.parent ? scope(b.parent) : new Set<string>();
      if (up) {
        s = new Set(up);
        for (const it of b.items) {
          if (it.key) s.add(it.key);
          if (it.table) s.add(it.table);
        }
      }
    }
    scopes.set(b, s);
    return s;
  };
  ts.forEach((t, k) => {
    const b = sc.owner[k];
    if (!b || !isNameLike(t) || !isPunct(ctx, k + 1, '.') || !isNameLike(ts[k + 2])) return;
    if (isPunct(ctx, k - 1, '.') || isPunct(ctx, k - 1, '@') || isPunct(ctx, k + 3, '.') || isPunct(ctx, k + 3, '(') || isPunct(ctx, k + 3, '@')) return;
    const col = word(ctx, k + 2);
    const q = nameKey(t.text);
    if (col === 'nextval' || col === 'currval' || PSEUDO_PREFIX.test(q) || ctes.has(q) || sh.inSpan(t.from)) return;
    const s = scope(b);
    if (s && !s.has(q)) emit('unknownAlias', t.from, t.to, { alias: t.text });
  });
}

function checkSetOps(ctx: Ctx, sc: Scan, emit: Emit): void {
  for (const [x, op, y] of sc.setOps) {
    const a = selectItems(ctx, x);
    const b = selectItems(ctx, y);
    if (a.length === 0 || b.length === 0 || [...a, ...b].some(([, q]) => isStarItem(ctx, q))) continue;
    if (a.length !== b.length) {
      emit('setColumnCount', ctx.ts[op]!.from, ctx.ts[op]!.to, { left: String(a.length), right: String(b.length) });
    }
  }
}

function lintTerminators(all: Token[], ol: SqlOutline, out: SqlProblem[]): void {
  let started = false;
  let plsql = false;
  let term = false;
  const hit = (t: Token): void => {
    if (!started && term) {
      const statement = Math.max(0, ol.statements.filter((s) => s.to <= t.from).length - 1);
      out.push({ code: 'emptyStatement', severity: SQL_LINT_SEVERITY.emptyStatement, from: t.from, to: t.to, statement });
    }
    started = false;
    plsql = false;
    term = true;
  };
  for (let i = 0; i < all.length; i++) {
    const t = all[i]!;
    if (t.kind === 'slash') hit(t);
    else if (TRIVIA.has(t.kind)) continue;
    else if (t.kind === 'punctuation' && t.text === ';' && !plsql) hit(t);
    else if (!started) {
      started = true;
      plsql = isPlsqlStart(all, i);
    }
  }
}

function conjuncts(ctx: Ctx, a: number, b: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = a;
  let d = 0;
  let caseD = 0;
  let between = false;
  for (let k = a; k < b; k++) {
    if (isPunct(ctx, k, '(')) d++;
    else if (isPunct(ctx, k, ')')) d--;
    else if (d === 0) {
      const lw = word(ctx, k);
      if (lw === 'case') caseD++;
      else if (lw === 'end' && caseD > 0) caseD--;
      else if (caseD === 0 && lw === 'between') between = true;
      else if (caseD === 0 && lw === 'and') {
        if (between) between = false;
        else {
          if (k > start) out.push([start, k]);
          start = k + 1;
        }
      }
    }
  }
  if (b > start) out.push([start, b]);
  return out;
}

function analyzeConj(ctx: Ctx, a0: number, b0: number): Conj {
  const { ts, match } = ctx;
  const c: Conj = {
    from: ts[a0]!.from, to: ts[b0 - 1]!.to, refs: [], bare: 0, branches: 1, isNull: false, hasCase: false, plus: false,
    hasSub: false,
  };
  let a = a0;
  let b = b0;
  while (b - a > 1 && isPunct(ctx, a, '(') && match[a] === b - 1) {
    a++;
    b--;
  }
  const fns: string[] = [];
  for (let k = a; k < b; k++) {
    const t = ts[k]!;
    if (t.kind === 'punctuation' && t.text === '(') {
      if (QUERY_START.has(word(ctx, k + 1))) {
        c.hasSub = true;
        const m = match[k] ?? -1;
        k = m > k && m < b ? m : b;
        continue;
      }
      if (t.text === '(' && ts[k + 1]?.text === '+' && isPunct(ctx, k + 2, ')')) {
        c.plus = true;
        k += 2;
        continue;
      }
      fns.push(word(ctx, k - 1));
      continue;
    }
    if (t.kind === 'punctuation' && t.text === ')') {
      fns.pop();
      continue;
    }
    const lw = word(ctx, k);
    if (lw === 'case') c.hasCase = true;
    else if (lw === 'is' && word(ctx, k + 1) === 'null') c.isNull = true;
    else if (lw === 'or' && fns.length === 0) {
      c.branches++;
      continue;
    }
    if (!isNameLike(t) || isPunct(ctx, k - 1, '.')) continue;
    let j = k;
    while (isPunct(ctx, j + 1, '.') && isNameLike(ts[j + 2])) j += 2;
    const call = isPunct(ctx, j + 1, '(') && !(ts[j + 2]?.text === '+' && isPunct(ctx, j + 3, ')'));
    if (!call) {
      if (j > k) {
        const q = ts[j - 2]!;
        c.refs.push({ key: nameKey(q.text), text: q.text, wrapped: fns.some((f) => NULL_SAFE.has(f)), branch: c.branches - 1 });
      } else if (isNameTok(ctx, k, b) && !NOT_COLUMN.has(lw)) c.bare++;
    }
    k = j;
  }
  return c;
}

function checkBlock(ctx: Ctx, blk: Block, emit: Emit): void {
  const { items } = blk;
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.key) continue;
    if (seen.has(it.key)) emit('duplicateAlias', it.keyFrom, it.keyTo, { alias: it.label });
    seen.add(it.key);
  }
  if (items.length < 2) return;
  const where = blk.where.flatMap(([a, b]) => conjuncts(ctx, a, b)).map(([a, b]) => analyzeConj(ctx, a, b));

  const nullable = new Map<string, string>();
  items.forEach((it, k) => {
    if (it.key && (it.join === 'left' || it.join === 'full')) nullable.set(it.key, it.label);
    if (it.join === 'right' || it.join === 'full') {
      for (let j = 0; j < k; j++) if (items[j]!.key) nullable.set(items[j]!.key, items[j]!.label);
    }
  });
  if (nullable.size > 0 && !blk.unsure) {
    for (const c of where) {
      if (c.isNull || c.hasCase || c.plus) continue;
      let alias = '';
      let all = true;
      for (let br = 0; br < c.branches && all; br++) {
        const r = c.refs.find((x) => x.branch === br && !x.wrapped && nullable.has(x.key));
        if (!r) all = false;
        else if (!alias) alias = nullable.get(r.key)!;
      }
      if (all && alias) emit('leftJoinUndone', c.from, c.to, { alias });
    }
  }

  if (blk.unsure || !items.some((it) => it.join === 'comma')) return;
  const parent = items.map((_, k) => k);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]!]!;
    return x;
  };
  const union = (x: number, y: number): void => {
    parent[find(x)] = find(y);
  };
  const byKey = new Map<string, number[]>();
  items.forEach((it, k) => {
    if (it.key) byKey.set(it.key, [...(byKey.get(it.key) ?? []), k]);
    if (k > 0 && (it.complex || (it.join !== 'comma' && it.join !== 'cross'))) union(k, k - 1);
  });
  const conds: Array<{ c: Conj; item: number }> = where.map((c) => ({ c, item: -1 }));
  for (const [item, a, b] of blk.ons) for (const [x, y] of conjuncts(ctx, a, b)) conds.push({ c: analyzeConj(ctx, x, y), item });
  for (const { c, item } of conds) {
    const idx = new Set<number>();
    for (const r of c.refs) for (const k of byKey.get(r.key) ?? []) idx.add(k);
    if (item >= 0) idx.add(item);
    if (c.hasSub || (c.bare > 0 && idx.size + c.bare >= 2)) return;
    const list = [...idx];
    for (let k = 1; k < list.length; k++) union(list[k]!, list[0]!);
  }
  const min = new Map<number, number>();
  items.forEach((_, k) => {
    const r = find(k);
    if (!min.has(r)) min.set(r, k);
  });
  items.forEach((it, k) => {
    if (k > 0 && it.join === 'comma' && !it.complex && it.key && min.get(find(k)) === k) {
      emit('cartesianJoin', it.from, it.to, { alias: it.label });
    }
  });
}

function stepAt(st: SqlStatementOutline, pos: number): string | undefined {
  for (const s of st.steps) if (s.kind === 'cte' && pos >= s.from && pos <= s.to) return s.name;
  for (const s of st.steps) if (s.kind === 'main' && pos >= s.from && pos <= s.to) return '';
  return undefined;
}

function lintStatement(ts: Token[], st: SqlStatementOutline, index: number, out: SqlProblem[]): void {
  const emit: Emit = (code, from, to, params) => {
    const p: SqlProblem = { code, severity: SQL_LINT_SEVERITY[code], from, to, statement: index };
    if (params) p.params = params;
    const step = stepAt(st, from);
    if (step !== undefined) p.step = step;
    out.push(p);
  };
  const open: Token[] = [];
  for (const t of ts) {
    if (t.kind !== 'punctuation') continue;
    if (t.text === '(') open.push(t);
    else if (t.text === ')' && !open.pop()) emit('unbalancedParens', t.from, t.to);
  }
  for (const t of open) emit('unbalancedParens', t.from, t.to);
  if (st.kind === 'plsql' || ts.length === 0) return;

  const ctx: Ctx = { ts, match: matchParens(ts), ctes: new Set() };
  const sc = scan(ctx, emit);
  const { blocks, stars } = sc;
  for (const blk of blocks) checkBlock(ctx, blk, emit);
  const spans = blocks.flatMap((b) => b.items.map((it) => [it.from, it.to] as const));
  const aliasIdx = new Set<number>();
  for (const blk of blocks) {
    for (const [a, b] of selectItems(ctx, blk)) {
      const o = outName(ctx, a, b);
      if (o?.alias) aliasIdx.add(o.k);
    }
  }
  const sh: Shared = { inSpan: (pos) => spans.some(([a, b]) => pos >= a && pos < b), aliasIdx };
  for (const blk of blocks) checkMore(ctx, blk, sh, emit);
  checkSetOps(ctx, sc, emit);
  checkAliases(ctx, st, sc, sh, emit);

  const feedsWrite = st.kind === 'insert' || st.kind === 'create';
  for (const s of stars) {
    if (s.exists) continue;
    if (feedsWrite || st.steps.some((x) => x.kind === 'cte' && s.from >= x.from && s.from <= x.to)) emit('selectStar', s.from, s.to);
  }

  const names = new Set<string>();
  for (const s of st.steps) {
    if (s.kind !== 'cte' || s.nameFrom === undefined || s.nameTo === undefined) continue;
    const key = nameKey(s.name);
    if (names.has(key)) emit('duplicateCte', s.nameFrom, s.nameTo, { name: s.name });
    else if (s.feeds.length === 0) emit('unusedCte', s.nameFrom, s.nameTo, { name: s.name });
    names.add(key);
  }
}

function lintMarkers(text: string, ol: SqlOutline, out: SqlProblem[]): void {
  const markers = sqlMarkers(text);
  const params = sqlParams(text);
  const emit = (code: SqlLintCode, from: number, to: number, p?: Record<string, string>): void => {
    let statement = ol.statements.findIndex((s) => from >= s.from && from <= s.to);
    if (statement < 0) statement = 0;
    const problem: SqlProblem = { code, severity: SQL_LINT_SEVERITY[code], from, to, statement };
    if (p) problem.params = p;
    out.push(problem);
  };

  for (let i = text.indexOf('/*%JS='); i >= 0; i = text.indexOf('/*%JS=', i + 1)) {
    if (!markers.some((m) => m.from === i)) emit('markerUnterminated', i, i + 6);
  }
  for (const m of markers) {
    if (!text.slice(m.fragmentFrom, m.fragmentTo).trim()) emit('markerNoFragment', m.from, m.to);
    else if (m.params.length > 0 && m.fragmentParams.length === 0) emit('markerFragmentNoParam', m.from, m.to);
  }
  for (const p of params) {
    if (p.uses.some((u) => u.kind === 'condition') && p.markers === 0 && p.unguarded === 0) {
      const u = p.uses.find((x) => x.kind === 'condition')!;
      emit('paramOnlyInCondition', u.from, u.to, { n: String(p.n) });
    }
  }
  for (let k = 1; k < params.length; k++) {
    const prev = params[k - 1]!.n;
    const cur = params[k]!;
    for (let n = prev + 1; n < cur.n; n++) emit('paramGap', cur.firstFrom, cur.firstFrom + String(cur.n).length + 2, { n: String(n) });
  }

  const IN = /\bin\s*\(([^()]*)\)/gi;
  for (const m of text.matchAll(IN)) {
    const inner = m[1]!;
    const base = m.index! + m[0].length - 1 - inner.length;
    for (const u of inner.matchAll(/\{(\d+)\}/g)) {
      const at = base + u.index!;
      if (markers.some((k) => at >= k.from && at < k.fragmentTo)) continue;
      emit('unguardedIn', at, at + u[0].length, { n: u[1]! });
    }
  }
}

/** Finds silent logic errors in SQL text (Oracle-first, standard SQL tolerated). Pure; never throws. */
export function sqlLint(text: string, outline?: SqlOutline): SqlProblem[] {
  const out: SqlProblem[] = [];
  try {
    const ol = outline ?? sqlOutline(text);
    try {
      lintMarkers(text, ol, out);
    } catch {
      // best effort
    }
    const all = tokenize(text);
    try {
      lintTerminators(all, ol, out);
    } catch {
      // best effort
    }
    let k = 0;
    ol.statements.forEach((st, index) => {
      while (k < all.length && all[k]!.from < st.from) k++;
      const ts: Token[] = [];
      while (k < all.length && all[k]!.to <= st.to) {
        if (!TRIVIA.has(all[k]!.kind)) ts.push(all[k]!);
        k++;
      }
      try {
        lintStatement(ts, st, index, out);
      } catch {
        // best effort per statement
      }
    });
  } catch {
    return out;
  }
  return out.sort((x, y) => x.from - y.from || x.to - y.to);
}
