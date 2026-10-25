import { t } from '@kedalion/ui';
import type { SqlLintSeverity, SqlProblem } from './sql/lint';

/** Most severe first. */
export const SQL_SEVERITIES: readonly SqlLintSeverity[] = ['error', 'warning', 'info'];

/** The localized message of a lint problem (`sqlLint.<code>` with its params). */
export function sqlProblemMessage(p: SqlProblem): string {
  return t(`sqlLint.${p.code}`, p.params);
}

/** The worst severity among the problems, or undefined when there are none. */
export function worstSeverity(problems: readonly SqlProblem[]): SqlLintSeverity | undefined {
  let worst: SqlLintSeverity | undefined;
  for (const p of problems) {
    if (p.severity === 'error') return 'error';
    if (p.severity === 'warning') worst = 'warning';
    else if (!worst) worst = 'info';
  }
  return worst;
}

/** Offsets where each line starts, for offset → line lookups. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** 1-based line of an offset. */
export function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
