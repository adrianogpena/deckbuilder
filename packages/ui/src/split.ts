/**
 * Pane sizes of a SplitView. Pure functions over fractions of the container (summing to 1) so
 * the app can persist them; pixel minimums are applied against the current container size.
 */

export const SPLIT_MIN_PX = 120;

const minOf = (minPx: number[], i: number) => Math.max(0, minPx[i] ?? SPLIT_MIN_PX);

function equal(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

function normalize(sizes: number[]): number[] {
  const valid = sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const sum = valid.reduce((a, b) => a + b, 0);
  return sum > 0 ? valid.map((s) => s / sum) : equal(sizes.length);
}

/**
 * Fractions summing to 1 where each pane is at least its minimum. Panes below their minimum get
 * it; the others shrink in proportion. Minimums adding up to more than the total → sizes
 * proportional to the minimums.
 */
export function clampSizes(sizes: number[], minPx: number[], totalPx: number): number[] {
  if (sizes.length === 0) return [];
  const out = normalize(sizes);
  if (!(totalPx > 0)) return out;
  const mins = out.map((_, i) => minOf(minPx, i) / totalPx);
  const minSum = mins.reduce((a, b) => a + b, 0);
  if (minSum >= 1) return minSum > 0 ? mins.map((m) => m / minSum) : equal(out.length);

  // Pin the panes below their minimum, spread the rest over the others; repeat until none is below.
  const pinned = new Set<number>();
  for (;;) {
    const free = 1 - [...pinned].reduce((a, i) => a + mins[i], 0);
    const others = out.map((_, i) => i).filter((i) => !pinned.has(i));
    const otherSum = others.reduce((a, i) => a + out[i], 0);
    for (const i of pinned) out[i] = mins[i];
    for (const i of others) out[i] = otherSum > 0 ? (out[i] / otherSum) * free : free / others.length;
    const below = others.filter((i) => out[i] < mins[i] - 1e-9);
    if (!below.length) return out;
    for (const i of below) pinned.add(i);
  }
}

/**
 * Moves the divider after pane `index` by `deltaPx`: only the two neighbours change, and neither
 * goes below its minimum. Returns new fractions.
 */
export function dragDivider(sizes: number[], index: number, deltaPx: number, totalPx: number, minPx: number[]): number[] {
  if (index < 0 || index >= sizes.length - 1 || !(totalPx > 0)) return sizes;
  const a = sizes[index];
  const b = sizes[index + 1];
  const lo = minOf(minPx, index) / totalPx - a;
  const hi = b - minOf(minPx, index + 1) / totalPx;
  if (lo > hi) return sizes;
  const d = Math.min(hi, Math.max(lo, deltaPx / totalPx));
  const out = sizes.slice();
  out[index] = a + d;
  out[index + 1] = b - d;
  return out;
}
