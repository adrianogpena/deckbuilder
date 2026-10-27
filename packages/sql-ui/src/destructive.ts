const stripNoise = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');

/** `sql` without parenthesised parts (subqueries), innermost first. */
const stripParens = (sql: string) => {
  let out = sql;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\([^()]*\)/g, ' ');
  }
  return out;
};

const destructiveStatement = (text: string) => {
  if (/^(drop|truncate|merge)\b/i.test(text)) return true;
  if (/^(delete|update)\b/i.test(text)) return !/\bwhere\b/i.test(stripParens(text));
  return false;
};

// A statement inside a PL/SQL body: at the start of a part, or after a keyword that opens one.
const BLOCK_STATEMENT = /(?:^|\b(?:begin|then|else|loop)\s+)(drop|truncate|merge|delete|update)\b/i;

/**
 * True when a statement drops, truncates or merges, or deletes or updates without a top-level WHERE;
 * the statements inside a `begin … end` block are checked too. Comments and string contents are ignored.
 */
export function isDestructive(sql: string): boolean {
  const text = stripNoise(sql).trim().replace(/;+\s*$/, '');
  if (/^(declare|begin)\b/i.test(text)) {
    return text.split(';').some((part) => {
      const body = part.trim().replace(/\bfor\s+update\b/gi, ' ');
      const m = BLOCK_STATEMENT.exec(body);
      return !!m && destructiveStatement(body.slice(m.index + m[0].length - m[1]!.length));
    });
  }
  return destructiveStatement(text);
}
