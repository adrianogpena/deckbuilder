/** Value at a dotted `path` (`data.items.0.count`) of parsed JSON; undefined when any step is missing. */
export function lookupPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split('.').filter((p) => p !== '')) {
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(part)) return undefined;
      cur = cur[Number(part)];
    } else if (typeof cur === 'object' && cur !== null && Object.hasOwn(cur, part)) {
      cur = (cur as Record<string, unknown>)[part];
    } else return undefined;
  }
  return cur;
}

/** The value as a finite number (numbers and numeric strings), else undefined. */
export function asNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
