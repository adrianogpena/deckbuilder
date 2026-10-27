export interface SqlMarker {
  from: number;
  to: number;
  condition: string;
  params: number[];
  fragmentFrom: number;
  fragmentTo: number;
  fragmentParams: number[];
}

export interface SqlParam {
  n: number;
  count: number;
  /** Uses inside a marker's guarded fragment. */
  markers: number;
  /** Uses outside any marker comment or fragment. */
  unguarded: number;
  firstFrom: number;
  /** Every `{n}` occurrence in document order. */
  uses: SqlParamUse[];
}

export interface SqlParamUse {
  from: number;
  to: number;
  /** `condition` inside a marker comment, `guarded` in a marker's fragment, else `unguarded`. */
  kind: 'condition' | 'guarded' | 'unguarded';
}

const MARKER = /\/\*%JS=([\s\S]*?)%\*\//g;
const PARAM = /\{(\d+)\}/g;

function paramsIn(s: string): number[] {
  const out = new Set<number>();
  for (const m of s.matchAll(PARAM)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

/** Finds `/*%JS=...%*\/` conditional markers and the rest-of-line fragment each guards. Never throws. */
export function sqlMarkers(text: string): SqlMarker[] {
  const out: SqlMarker[] = [];
  try {
    for (const m of text.matchAll(MARKER)) {
      const from = m.index!;
      const to = from + m[0].length;
      let end = text.indexOf('\n', to);
      if (end < 0) end = text.length;
      if (end > to && text[end - 1] === '\r') end--;
      const condition = m[1]!.trim();
      out.push({
        from,
        to,
        condition,
        params: paramsIn(condition),
        fragmentFrom: to,
        fragmentTo: end,
        fragmentParams: paramsIn(text.slice(to, end)),
      });
    }
  } catch {
    return [];
  }
  return out;
}

/** Summarises every `{n}` placeholder: total, guarded and unguarded uses. Never throws. */
export function sqlParams(text: string): SqlParam[] {
  const map = new Map<number, SqlParam>();
  try {
    const markers = sqlMarkers(text);
    for (const m of text.matchAll(PARAM)) {
      const at = m.index!;
      const n = Number(m[1]);
      let p = map.get(n);
      if (!p) {
        p = { n, count: 0, markers: 0, unguarded: 0, firstFrom: at, uses: [] };
        map.set(n, p);
      }
      p.count++;
      let kind: SqlParamUse['kind'] = 'unguarded';
      if (markers.some((k) => at >= k.fragmentFrom && at < k.fragmentTo)) {
        p.markers++;
        kind = 'guarded';
      } else if (markers.some((k) => at >= k.from && at < k.to)) kind = 'condition';
      else p.unguarded++;
      p.uses.push({ from: at, to: at + m[0].length, kind });
    }
  } catch {
    return [];
  }
  return [...map.values()].sort((a, b) => a.n - b.n);
}

type Value = string | number | boolean;
type Token = { t: 'str' | 'num' | 'id' | 'op'; v: string | number };

const OPS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '(', ')', '.', '=', ';'];

/** Tokenizes a marker condition; `{n}` inside a string literal or bare becomes the raw value as a string token. */
function tokenize(src: string, values: Record<number, string>): Token[] {
  const out: Token[] = [];
  const param = (n: string) => values[Number(n)] ?? '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let s = '';
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const e = src[i + 1]!;
          s += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e;
          i += 2;
          continue;
        }
        const p = /^\{(\d+)\}/.exec(src.slice(i));
        if (p) {
          s += param(p[1]!);
          i += p[0].length;
          continue;
        }
        s += src[i];
        i++;
      }
      if (i >= src.length) throw new Error('unterminated string');
      i++;
      out.push({ t: 'str', v: s });
      continue;
    }
    const rest = src.slice(i);
    const p = /^\{(\d+)\}/.exec(rest);
    if (p) {
      out.push({ t: 'str', v: param(p[1]!) });
      i += p[0].length;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(rest);
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (id) {
      out.push({ t: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (!op) throw new Error(`unexpected '${c}'`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

/** Evaluates `result = <expr>` with literals, `{n}`, `.length`, comparisons, `!`, `&&`, `||` and parentheses. Throws on anything else. */
function evalCondition(condition: string, values: Record<number, string>): boolean {
  const toks = tokenize(condition, values);
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected '${v}'`);
    pos++;
  };
  const or = (): Value => {
    let l = and();
    while (isOp('||')) {
      pos++;
      const r = and();
      l = l || r;
    }
    return l;
  };
  const and = (): Value => {
    let l = equality();
    while (isOp('&&')) {
      pos++;
      const r = equality();
      l = l && r;
    }
    return l;
  };
  const equality = (): Value => {
    let l = relational();
    for (;;) {
      const t = peek();
      if (t?.t !== 'op' || !['==', '===', '!=', '!=='].includes(t.v as string)) return l;
      pos++;
      const r = relational();
      const eq = t.v === '==' || t.v === '!=' ? l == r : l === r;
      l = (t.v as string).startsWith('=') ? eq : !eq;
    }
  };
  const relational = (): Value => {
    let l = unary();
    for (;;) {
      const t = peek();
      if (t?.t !== 'op' || !['<', '<=', '>', '>='].includes(t.v as string)) return l;
      pos++;
      const r = unary();
      const a = l as number;
      const b = r as number;
      l = t.v === '<' ? a < b : t.v === '<=' ? a <= b : t.v === '>' ? a > b : a >= b;
    }
  };
  const unary = (): Value => {
    if (isOp('!')) {
      pos++;
      return !unary();
    }
    let v = primary();
    while (isOp('.')) {
      pos++;
      const t = peek();
      if (t?.t !== 'id' || t.v !== 'length') throw new Error('only .length is supported');
      if (typeof v !== 'string') throw new Error('.length needs a string');
      pos++;
      v = v.length;
    }
    return v;
  };
  const primary = (): Value => {
    const t = peek();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'str' || t.t === 'num') {
      pos++;
      return t.v;
    }
    if (t.t === 'id' && (t.v === 'true' || t.v === 'false')) {
      pos++;
      return t.v === 'true';
    }
    if (isOp('(')) {
      pos++;
      const v = or();
      expect(')');
      return v;
    }
    throw new Error(`unexpected '${t.v}'`);
  };
  const first = peek();
  if (first?.t !== 'id' || first.v !== 'result') throw new Error("expected 'result = <expression>'");
  pos++;
  expect('=');
  const result = or();
  if (isOp(';')) pos++;
  if (pos < toks.length) throw new Error(`unexpected '${toks[pos]!.v}'`);
  return !!result;
}

/** Applies the `{n}` values: evaluates each marker, drops its comment (and its fragment when false), then substitutes the remaining `{n}` raw. Keeps the line count. */
export function resolveMarkers(text: string, values: Record<number, string>): { sql: string; error?: string } {
  const markers = sqlMarkers(text);
  let out = '';
  let at = 0;
  for (const m of markers) {
    let keep: boolean;
    try {
      keep = evalCondition(m.condition, values);
    } catch (e) {
      return { sql: text, error: `${m.condition}: ${e instanceof Error ? e.message : String(e)}` };
    }
    const dropped = text.slice(m.from, m.to);
    out += fill(text.slice(at, m.from), values) + dropped.replace(/[^\r\n]/g, '');
    const fragment = text.slice(m.fragmentFrom, m.fragmentTo);
    out += keep ? fill(fragment, values) : fragment.replace(/[^\r\n]/g, '');
    at = m.fragmentTo;
  }
  out += fill(text.slice(at), values);
  return { sql: out };
}

function fill(s: string, values: Record<number, string>): string {
  return s.replace(PARAM, (_, n: string) => values[Number(n)] ?? '');
}
