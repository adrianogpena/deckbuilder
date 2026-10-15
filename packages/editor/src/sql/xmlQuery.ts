/** SQL inside Miles query files: `<queries><query name=".."><statement><![CDATA[ SQL ]]></statement></query></queries>`. */

export interface XmlQueryStatement {
  /** Position among the file's statements. */
  index: number;
  /** `name` attribute of the enclosing `<query>` ('' when none). */
  name: string;
  /** `set-name` attribute of the enclosing `<query>` ('' when none). */
  setName: string;
  /** Display label: name, set-name or `#n`. */
  label: string;
  /** The SQL to edit (prefix text + CDATA content, or unescaped text). */
  sql: string;
  /** Range of the file text that `sql` stands for; `spliceXmlStatement` replaces exactly this. */
  from: number;
  to: number;
  /** True when the statement holds a CDATA section. */
  cdata: boolean;
  /** Non-blank text before the first CDATA section (already part of `sql`); '' otherwise. */
  prefix: string;
}

export interface XmlQueries {
  statements: XmlQueryStatement[];
}

const ESCAPES: [RegExp, string][] = [[/&lt;/g, '<'], [/&gt;/g, '>'], [/&quot;/g, '"'], [/&apos;/g, "'"], [/&amp;/g, '&']];

export function unescapeXml(s: string): string {
  let out = s;
  for (const [re, ch] of ESCAPES) out = out.replace(re, ch);
  return out;
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const blank = (m: string) => m.replace(/[^\r\n]/g, ' ');

/** Same length as `text`, with comments and CDATA bodies blanked so tag searches cannot hit them. */
function mask(text: string): string {
  return text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, (m) => (m.startsWith('<!--') ? blank(m) : `<![CDATA[${blank(m.slice(9, -3))}]]>`));
}

function attr(tag: string, key: string): string {
  const m = new RegExp(`\\s${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? unescapeXml(m[1] ?? m[2] ?? '') : '';
}

/** The statements of a `<queries>` file, or null when the root is not `<queries>` or no `<statement>` exists. */
export function parseXmlQueries(text: string): XmlQueries | null {
  const masked = mask(text);
  const root = /^﻿?\s*(?:<\?[\s\S]*?\?>\s*|<!DOCTYPE[^>]*>\s*)*<([A-Za-z_][\w.:-]*)/.exec(masked);
  if (!root || root[1] !== 'queries') return null;
  const statements: XmlQueryStatement[] = [];
  const re = /<statement\b[^>]*?(\/)?>(?:([\s\S]*?)<\/statement\s*>)?/g;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    if (m[1] || m[2] === undefined) continue;
    const innerFrom = m.index + m[0].indexOf('>') + 1;
    const inner = text.slice(innerFrom, innerFrom + m[2].length);
    const before = masked.slice(0, m.index);
    const q = before.lastIndexOf('<query');
    const closed = before.lastIndexOf('</query');
    let name = '';
    let setName = '';
    if (q >= 0 && closed < q && /^<query[\s>]/.test(before.slice(q))) {
      const tag = before.slice(q, before.indexOf('>', q) + 1);
      name = attr(tag, 'name');
      setName = attr(tag, 'set-name');
    }
    const index = statements.length;
    const label = name || setName || `#${index + 1}`;
    const first = inner.indexOf('<![CDATA[');
    if (first < 0) {
      statements.push({ index, name, setName, label, sql: unescapeXml(inner), from: innerFrom, to: innerFrom + inner.length, cdata: false, prefix: '' });
      continue;
    }
    const lastEnd = inner.lastIndexOf(']]>') + 3;
    const lead = inner.slice(0, first);
    const keepLead = lead.trim() === '';
    const start = keepLead ? first : 0;
    let sql = keepLead ? '' : lead;
    const cd = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
    let pos = first;
    for (let c = cd.exec(inner); c; c = cd.exec(inner)) {
      sql += inner.slice(pos, c.index) + c[1];
      pos = c.index + c[0].length;
    }
    sql += inner.slice(pos, lastEnd);
    statements.push({ index, name, setName, label, sql, from: innerFrom + start, to: innerFrom + lastEnd, cdata: true, prefix: keepLead ? '' : lead });
  }
  return statements.length > 0 ? { statements } : null;
}

const cdataOf = (sql: string) => `<![CDATA[${sql.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

/** Writes edited SQL back into one statement of `text`; every other byte stays. `sql` unchanged returns `text` itself. */
export function spliceXmlStatement(text: string, st: XmlQueryStatement, sql: string): string {
  if (sql === st.sql) return text;
  let body: string;
  if (!st.cdata) body = escapeXml(sql);
  else if (st.prefix && sql.startsWith(st.prefix)) body = st.prefix + cdataOf(sql.slice(st.prefix.length));
  else body = cdataOf(sql);
  return text.slice(0, st.from) + body + text.slice(st.to);
}

const SEP_LINE = /^-- ==== (.*) ====[ \t]*\r?$/;
const labelOf = (st: XmlQueryStatement) => st.label.replace(/\s+/g, ' ');
const sepOf = (st: XmlQueryStatement) => `-- ==== ${labelOf(st)} ====`;

/** Terminator the statement splitter needs after `sql` ('' when it already ends in `;` or is empty). */
function suffixFor(sql: string): string {
  const body = sql.trimEnd();
  if (!body || body.endsWith(';')) return '';
  const last = body.slice(body.lastIndexOf('\n') + 1);
  return last.includes('--') ? '\n;' : ';';
}

/** One editor value for all statements: a separator comment line per statement, blank line between. One statement: its SQL as is. */
export function combineXmlStatements(statements: XmlQueryStatement[]): string {
  if (statements.length === 1) return statements[0]!.sql;
  return statements
    .map((st) => {
      const body = st.sql.trimEnd();
      return `${sepOf(st)}\n${body}${suffixFor(st.sql)}${st.sql.slice(body.length)}`;
    })
    .join('\n\n');
}

/** Maps an edited combined value back to one SQL per statement. Missing separators leave that statement empty and its text with the previous one. */
export function splitXmlStatements(statements: XmlQueryStatement[], combined: string): string[] {
  if (statements.length === 1) return [combined];
  const segs: string[] = statements.map(() => '');
  const lines = combined.split('\n');
  let next = 0;
  let cur = -1;
  let pre = '';
  const add = (line: string, last: boolean) => {
    const piece = last ? line : `${line}\n`;
    if (cur < 0) pre += piece;
    else segs[cur] += piece;
  };
  lines.forEach((line, i) => {
    const m = SEP_LINE.exec(line);
    const hit = m ? statements.findIndex((st, j) => j >= next && labelOf(st) === m[1]) : -1;
    if (hit >= 0) {
      cur = hit;
      next = hit + 1;
      return;
    }
    add(line, i === lines.length - 1);
  });
  segs[0] = pre + segs[0];
  return statements.map((st, i) => {
    let seg = segs[i]!;
    if (i < statements.length - 1) seg = seg.endsWith('\n\n') ? seg.slice(0, -2) : seg.endsWith('\n') ? seg.slice(0, -1) : seg;
    const body = seg.trimEnd();
    const suffix = suffixFor(st.sql);
    return (suffix && body.endsWith(suffix) ? body.slice(0, -suffix.length) : body) + seg.slice(body.length);
  });
}

/** Writes an edited combined value back into `text`; unchanged statements keep their bytes, an unchanged value returns `text` itself. */
export function applyCombinedXml(text: string, statements: XmlQueryStatement[], combined: string): string {
  const sqls = splitXmlStatements(statements, combined);
  let out = text;
  for (let i = statements.length - 1; i >= 0; i--) out = spliceXmlStatement(out, statements[i]!, sqls[i]!);
  return out;
}

/** Blanks comments and string literals (same length) so structure scans ignore them. */
function blankSql(sql: string): string {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, blank);
}

/** Names exposed by the outermost select list (aliases or plain column names, lower-cased). Unsure items are skipped. */
function selectNames(sql: string): Set<string> {
  const s = blankSql(sql);
  const names = new Set<string>();
  const sel = /\bselect\b/i.exec(s);
  if (!sel) return names;
  let depth = 0;
  let start = sel.index + sel[0].length;
  const items: string[] = [];
  let end = s.length;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    } else if (depth === 0 && c === ',') {
      items.push(s.slice(start, i));
      start = i + 1;
    } else if (depth === 0 && /\s/.test(s[i - 1] ?? ' ') && /^from\b/i.test(s.slice(i))) {
      end = i;
      break;
    }
  }
  items.push(s.slice(start, end));
  for (const raw of items) {
    const item = raw.replace(/^\s*(?:distinct|unique|all)\s+/i, '').trim();
    if (!item || item.endsWith('*')) continue;
    const q = /(?:\s|\)|^)"([^"]+)"$/.exec(item);
    if (q) {
      names.add(q[1]!.toLowerCase());
      continue;
    }
    const plain = /^(?:[A-Za-z_][\w$#]*\.)*([A-Za-z_][\w$#]*)$/.exec(item);
    if (plain) {
      names.add(plain[1]!.toLowerCase());
      continue;
    }
    const alias = /[\s)"'\w]\s+(?:as\s+)?([A-Za-z_][\w$#]*)$/i.exec(item);
    if (alias && !/[+\-*/|<>=]\s*$/.test(item.slice(0, item.length - alias[1]!.length).trimEnd())) names.add(alias[1]!.toLowerCase());
  }
  return names;
}

const PLACEHOLDER = /\{([A-Za-z_]\w*)\}/g;

/**
 * One SQL from chained Miles queries: `{name}` in a later statement becomes a scalar subquery of the nearest earlier statement
 * whose select list exposes `name`. Numeric `{0}` parameters and unresolved names stay. The result is the last statement, earlier ones inlined.
 */
export function mergeXmlStatements(statements: XmlQueryStatement[]): string {
  const merged: string[] = [];
  const names = statements.map((st) => selectNames(st.sql));
  statements.forEach((st, i) => {
    merged.push(
      st.sql.replace(PLACEHOLDER, (all, name: string) => {
        for (let j = i - 1; j >= 0; j--) {
          if (!names[j]!.has(name.toLowerCase())) continue;
          const inner = merged[j]!.trimEnd().replace(/\s*;+$/, '');
          const lastLine = inner.slice(inner.lastIndexOf('\n') + 1);
          const close = lastLine.includes('--') ? '\n' : '';
          return `(SELECT ${name} FROM (${inner}${close}) WHERE ROWNUM = 1)`;
        }
        return all;
      }),
    );
  });
  const header = `-- merged from: ${statements.map(labelOf).join(', ')}`;
  return `${header}\n${(merged[merged.length - 1] ?? '').trim()}`;
}
