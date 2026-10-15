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

function escapeJs(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

const SIMPLE = /^result\s*=\s*\(?\s*'((?:[^'\\]|\\.)*)'\s*(===?|!==?)\s*'((?:[^'\\]|\\.)*)'\s*\)?\s*;?$/;
const unescapeJs = (s: string) => s.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c));

function evalCondition(condition: string, values: Record<number, string>): boolean {
  const code = condition.replace(/(['"]?)\{(\d+)\}(['"]?)/g, (_, a: string, n: string, b: string) => {
    const v = escapeJs(values[Number(n)] ?? '');
    return a ? `${a}${v}${b}` : `'${v}'${b}`;
  });
  const simple = SIMPLE.exec(code.trim());
  if (simple) {
    const equal = unescapeJs(simple[1]!) === unescapeJs(simple[3]!);
    return simple[2]!.startsWith('=') ? equal : !equal;
  }
  return !!new Function('result', `${code}\n;return result;`)(undefined);
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
