export interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string[];
  run(): void;
}

/** Matching items best first; an empty query keeps the given order. */
export function filterPalette(items: PaletteItem[], query: string, limit = 60): PaletteItem[] {
  const q = query.trim().toLowerCase().replace(/^:/, '');
  if (!q) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: score(item, q) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.item);
}

function score(item: PaletteItem, q: string): number {
  const keywords = item.keywords ?? [];
  const [head, ...rest] = q.split(/\s+/);
  const tail = rest.join(' ');
  // "ctx foo" style prefixes narrow to that group.
  if (tail && keywords[0] === head) {
    return item.label.toLowerCase().includes(tail) ? 100 : 0;
  }
  let best = 0;
  for (const kw of keywords) {
    if (kw === q) best = Math.max(best, 90);
    else if (kw.startsWith(q)) best = Math.max(best, 60);
    else if (kw.includes(q)) best = Math.max(best, 30);
  }
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) best = Math.max(best, 50);
  else if (label.includes(q)) best = Math.max(best, 20);
  return best;
}
