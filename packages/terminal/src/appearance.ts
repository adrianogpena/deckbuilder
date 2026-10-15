export const FONT_WEIGHTS = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
export const CURSOR_STYLES = ['block', 'bar', 'underline'] as const;

/** The look of one profile; a set field wins over the global terminal setting of the same name. */
export interface ProfileAppearance {
  fontFamily?: string;
  /** Pixels, 8 to 32. */
  fontSize?: number;
  fontWeight?: (typeof FONT_WEIGHTS)[number];
  /** 1 to 2. */
  lineHeight?: number;
  /** A preset id or a custom scheme id; an unknown one follows the app. */
  theme?: string;
  cursorStyle?: (typeof CURSOR_STYLES)[number];
  cursorBlink?: boolean;
  /** Pixels, 0 to 48. */
  padding?: number;
}

type Check = (v: unknown) => boolean;
const range = (min: number, max: number): Check => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const oneOf = (values: readonly string[]): Check => (v) => typeof v === 'string' && values.includes(v);
const text = (max: number): Check => (v) => typeof v === 'string' && v.length <= max;

/** Same ranges as the flat `terminal.*` settings. */
const APPEARANCE_SPEC: Record<keyof ProfileAppearance, Check> = {
  fontFamily: text(300),
  fontSize: range(8, 32),
  fontWeight: oneOf(FONT_WEIGHTS),
  lineHeight: range(1, 2),
  theme: (v) => typeof v === 'string' && /^[\w.-]{1,64}$/.test(v),
  cursorStyle: oneOf(CURSOR_STYLES),
  cursorBlink: (v) => typeof v === 'boolean',
  padding: range(0, 48),
};

/** A profile's `appearance` with only known keys and values in range; else null. */
export function validAppearance(v: unknown): ProfileAppearance | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  for (const [k, x] of Object.entries(v)) {
    const check = APPEARANCE_SPEC[k as keyof ProfileAppearance];
    if (!Object.hasOwn(APPEARANCE_SPEC, k) || !check(x)) return null;
  }
  return v as ProfileAppearance;
}

/** `base` with the set fields of `appearance` over it (an empty font family keeps the base one). */
export function withAppearance<T extends object>(base: T | undefined, appearance: ProfileAppearance | undefined): T | undefined {
  if (!appearance) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(appearance)) {
    if (v === undefined || (k === 'fontFamily' && typeof v === 'string' && !v.trim())) continue;
    out[k] = v;
  }
  return out as T;
}
