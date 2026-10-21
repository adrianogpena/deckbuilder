export interface LineItem {
  label: string;
  url: string;
}

/** Whether `raw` is an absolute http(s) URL. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** `label | url` per line; blank lines, `#` comments and non-http(s) URLs are skipped; a bare URL labels itself. */
export function parseLines(text: string, max = Infinity): LineItem[] {
  const out: LineItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const bar = line.lastIndexOf('|');
    const url = (bar < 0 ? line : line.slice(bar + 1)).trim();
    if (!isHttpUrl(url)) continue;
    const label = bar < 0 ? '' : line.slice(0, bar).trim();
    out.push({ label: label || url, url });
    if (out.length >= max) break;
  }
  return out;
}
