/** Each refresh that finds nothing changed waits this much longer than the one before, up to MAX_BACKOFF times the interval. */
const BACKOFF = 1.5;
const MAX_BACKOFF = 4;

/** The refresh interval after `unchanged` refreshes in a row found the same data. */
export const backoffMs = (baseMs: number, unchanged: number): number => Math.round(baseMs * Math.min(MAX_BACKOFF, BACKOFF ** Math.max(0, unchanged)));

/** The count of unchanged refreshes after one more: it grows on an automatic refresh with the same data and resets otherwise. */
export const nextUnchanged = (unchanged: number, same: boolean, auto: boolean): number => (auto && same ? unchanged + 1 : 0);
