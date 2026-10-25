export const SIDE_W = { min: 560, max: 980 } as const;

export function clampSideWidth(w: number): number {
  return Math.min(SIDE_W.max, Math.max(SIDE_W.min, Math.round(w)));
}

/** Default width: 64% of the viewport, clamped. */
export function defaultSideWidth(viewportW: number): number {
  return clampSideWidth(Math.round(viewportW * 0.64));
}

/** Stored width from `raw`, or null when it is not a finite number. */
export function parseSideWidth(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clampSideWidth(n) : null;
}

export function sideWidthKey(scope: string): string {
  return `kedalion.viewSide.${scope}.w`;
}

export function readSideWidth(scope: string): number | null {
  try {
    return parseSideWidth(localStorage.getItem(sideWidthKey(scope)));
  } catch {
    return null;
  }
}

export function writeSideWidth(scope: string, w: number): void {
  try {
    localStorage.setItem(sideWidthKey(scope), String(clampSideWidth(w)));
  } catch {
    // storage unavailable
  }
}
