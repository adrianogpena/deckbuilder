const stripNoise = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');

/** True when a statement drops or truncates, or deletes or updates without a WHERE. Comments and string contents are ignored. */
export function isDestructive(sql: string): boolean {
  const text = stripNoise(sql).trim().replace(/;+\s*$/, '');
  if (/^(drop|truncate)\b/i.test(text)) return true;
  if (/^(delete|update)\b/i.test(text)) return !/\bwhere\b/i.test(text);
  return false;
}
