export interface FuzzyMatch {
  score: number;
  /** Indices of the target characters that matched, ascending. */
  positions: number[];
}

const SEPARATORS = '/\-_. :,;()[]{}<>';
const isSeparator = (c: string | undefined) => c !== undefined && SEPARATORS.includes(c);
const isUpper = (c: string) => c !== c.toLowerCase();

/** Bonus for the character at `i` standing at a word start: after a separator, a camelCase hump, or the first one. */
function boundary(target: string, i: number): number {
  if (i === 0) return 8;
  const prev = target[i - 1]!;
  if (isSeparator(prev)) return prev === '/' || prev === '\\' ? 8 : 6;
  if (isUpper(target[i]!) && !isUpper(prev)) return 6;
  return 0;
}

const UNREACHED = -1;

/**
 * Matches the characters of `query` in order (not necessarily adjacent, case-insensitive) against
 * `target`. Scores contiguous runs, word starts and exact case higher, after VS Code's fuzzy scorer.
 * Undefined when a query character is missing. An empty query matches with score 0.
 */
export function fuzzyScore(query: string, target: string): FuzzyMatch | undefined {
  const n = query.length;
  const m = target.length;
  if (n === 0) return { score: 0, positions: [] };
  if (n > m) return undefined;
  const q = query.toLowerCase();
  const tl = target.toLowerCase();

  // best[i][j]: best score with query[i] matched at target[j]; run[i][j]: length of the contiguous run ending there.
  const best: number[][] = [];
  const run: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < n; i++) {
    best.push(new Array<number>(m).fill(UNREACHED));
    run.push(new Array<number>(m).fill(0));
    from.push(new Array<number>(m).fill(-1));
    for (let j = i; j < m; j++) {
      if (q[i] !== tl[j]) continue;
      const own = 1 + (query[i] === target[j] ? 1 : 0) + boundary(target, j);
      if (i === 0) {
        best[i]![j] = own;
        run[i]![j] = 1;
        continue;
      }
      let top = UNREACHED;
      let topFrom = -1;
      let topRun = 0;
      for (let k = i - 1; k < j; k++) {
        const prev = best[i - 1]![k]!;
        if (prev === UNREACHED) continue;
        const contiguous = k === j - 1;
        const length = contiguous ? run[i - 1]![k]! + 1 : 1;
        const total = prev + own + (contiguous ? 5 * Math.min(length - 1, 3) : 0);
        if (total > top) {
          top = total;
          topFrom = k;
          topRun = length;
        }
      }
      if (top !== UNREACHED) {
        best[i]![j] = top;
        run[i]![j] = topRun;
        from[i]![j] = topFrom;
      }
    }
  }

  let end = -1;
  let score = UNREACHED;
  for (let j = n - 1; j < m; j++) {
    if (best[n - 1]![j]! > score) {
      score = best[n - 1]![j]!;
      end = j;
    }
  }
  if (end < 0) return undefined;
  const positions = new Array<number>(n);
  for (let i = n - 1, j = end; i >= 0; i--) {
    positions[i] = j;
    j = from[i]![j]!;
  }
  return { score, positions };
}

export interface PathMatch {
  score: number;
  /** Indices into the full path. */
  positions: number[];
}

/**
 * Scores a relative path against a query. A query with `/` matches the whole path; otherwise the
 * file name is tried first (ranked above any path-only match), then the whole path.
 */
export function fuzzyPath(query: string, path: string): PathMatch | undefined {
  const q = query.trim().replace(/\\/g, '/');
  if (!q) return { score: 0, positions: [] };
  if (q.includes('/')) return fuzzyScore(q.replace(/\s+/g, ''), path);
  const compact = q.replace(/\s+/g, '');
  const at = path.lastIndexOf('/') + 1;
  const byName = fuzzyScore(compact, path.slice(at));
  if (byName) return { score: byName.score + 1000, positions: byName.positions.map((p) => p + at) };
  return fuzzyScore(compact, path);
}

/** `text` split into runs, `hit` true for the characters at `positions`. */
export function highlightRuns(text: string, positions: readonly number[]): Array<{ text: string; hit: boolean }> {
  const marked = new Set(positions);
  const runs: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const hit = marked.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else runs.push({ text: text[i]!, hit });
  }
  return runs;
}
