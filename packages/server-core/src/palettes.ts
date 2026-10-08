// Colour palettes: values for every colour token of packages/ui/src/styles.css. Pure module,
// shared by the server (settings validation) and the web UI (applies the tokens).

export type ThemeKind = 'dark' | 'light';
export type ThemePreference = 'system' | ThemeKind;

export interface ThemeSettings {
  theme: ThemePreference;
  /** Palette id used when the effective theme is dark; unset means the default (or the light pick's family). */
  paletteDark?: string;
  paletteLight?: string;
}

export const TOKENS = [
  '--bg', '--bg-elev', '--bg-sunken', '--panel', '--panel-2', '--hover', '--selected', '--side-active',
  '--border', '--border-soft', '--row-border', '--keycap',
  '--text', '--text-2', '--text-3',
  '--accent', '--accent-2', '--accent-soft', '--ink-on-accent',
  '--ok', '--ok-soft', '--warn', '--warn-soft', '--err', '--err-soft', '--ink-on-err',
  '--info', '--info-soft', '--debug', '--debug-soft', '--muted-soft',
  '--y-key', '--y-str', '--y-num', '--y-bool', '--y-comment', '--mark',
  '--shadow', '--backdrop',
] as const;

export type Token = (typeof TOKENS)[number];

export interface Palette {
  id: string;
  label: string;
  /** Palettes of one family are the dark and light take on the same scheme. */
  family: string;
  kind: ThemeKind;
  /** `--shadow` is a box-shadow value, every other token a colour. */
  tokens: Record<Token, string>;
}

export const DEFAULT_DARK = 'deckbuilder-dark';
export const DEFAULT_LIGHT = 'deckbuilder-light';

const DECKBUILDER_DARK: Record<Token, string> = {
  '--bg': '#0d0e11',
  '--bg-elev': '#121317',
  '--bg-sunken': '#0a0b0d',
  '--panel': '#121317',
  '--panel-2': '#16181d',
  '--hover': '#1c1f25',
  '--selected': '#1a1830',
  '--side-active': '#1f1c33',
  '--border': '#262a32',
  '--border-soft': '#1d2027',
  '--row-border': '#1a1d23',
  '--keycap': '#363b45',
  '--text': '#eceef2',
  '--text-2': '#a6acb7',
  '--text-3': '#6c727d',
  '--accent': '#9b8cff',
  '--accent-2': '#c3b9ff',
  '--accent-soft': 'rgba(155, 140, 255, 0.14)',
  '--ink-on-accent': '#120d2b',
  '--ok': '#3ddc97',
  '--ok-soft': 'rgba(61, 220, 151, 0.12)',
  '--warn': '#f5b83d',
  '--warn-soft': 'rgba(245, 184, 61, 0.13)',
  '--err': '#ff6b6b',
  '--err-soft': 'rgba(255, 107, 107, 0.13)',
  '--ink-on-err': '#fff',
  '--info': '#5fb4ff',
  '--info-soft': 'rgba(95, 180, 255, 0.13)',
  '--debug': '#8b93a1',
  '--debug-soft': 'rgba(139, 147, 161, 0.14)',
  '--muted-soft': 'rgba(148, 163, 184, 0.12)',
  '--y-key': '#7cc4ff',
  '--y-str': '#9ee6c0',
  '--y-num': '#fcd34d',
  '--y-bool': '#f0abfc',
  '--y-comment': '#5b6370',
  '--mark': 'rgba(245, 184, 61, 0.35)',
  '--shadow': '0 30px 80px rgba(0, 0, 0, 0.6)',
  '--backdrop': 'rgba(3, 7, 12, 0.55)',
};

const DECKBUILDER_LIGHT: Record<Token, string> = {
  '--bg': '#f4f6f9',
  '--bg-elev': '#ffffff',
  '--bg-sunken': '#eef1f5',
  '--panel': '#ffffff',
  '--panel-2': '#f7f9fb',
  '--hover': '#eef3f8',
  '--selected': '#ece8fd',
  '--side-active': 'rgba(106, 79, 216, 0.1)',
  '--border': '#d7dee7',
  '--border-soft': '#e6ebf1',
  '--row-border': '#e6ebf1',
  '--keycap': '#c9d2dc',
  '--text': '#17212c',
  '--text-2': '#4b5b6c',
  '--text-3': '#7c8a99',
  '--accent': '#6a4fd8',
  '--accent-2': '#5638c4',
  '--accent-soft': 'rgba(106, 79, 216, 0.1)',
  '--ink-on-accent': '#ffffff',
  '--ok': '#059669',
  '--ok-soft': 'rgba(5, 150, 105, 0.1)',
  '--warn': '#b45309',
  '--warn-soft': 'rgba(217, 119, 6, 0.12)',
  '--err': '#dc2626',
  '--err-soft': 'rgba(220, 38, 38, 0.1)',
  '--ink-on-err': '#fff',
  '--info': '#2563eb',
  '--info-soft': 'rgba(37, 99, 235, 0.1)',
  '--debug': '#64748b',
  '--debug-soft': 'rgba(100, 116, 139, 0.12)',
  '--muted-soft': 'rgba(100, 116, 139, 0.1)',
  '--y-key': '#0369a1',
  '--y-str': '#047857',
  '--y-num': '#b45309',
  '--y-bool': '#a21caf',
  '--y-comment': '#94a3b8',
  '--mark': 'rgba(251, 191, 36, 0.45)',
  '--shadow': '0 20px 50px rgba(15, 23, 42, 0.18)',
  '--backdrop': 'rgba(15, 23, 42, 0.35)',
};

/** The 12 role colours of a session-deck palette, in this order. */
type Roles = [
  bg: number, surface: number, border: number, text: number, textDim: number, accent: number,
  purple: number, cyan: number, green: number, yellow: number, orange: number, red: number,
];

type Rgb = [number, number, number];

const rgb = (hex: number): Rgb => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
/** Per-channel blend of the sRGB values, like CSS `color-mix(in srgb, a, b t)`. */
const mix = (a: Rgb, b: Rgb, t: number) => hex(a.map((v, i) => Math.round(v * (1 - t) + b[i] * t)) as Rgb);
const alpha = (c: Rgb, a: number) => `rgba(${c.join(', ')}, ${a})`;

const BLACK: Rgb = [0, 0, 0];

/** Tokens of a session-deck palette, derived from its role colours. */
function fromRoles(kind: ThemeKind, roles: Roles): Record<Token, string> {
  const [bg, surface, border, text, textDim, accent, purple, cyan, green, yellow, orange, red] = roles.map(rgb);
  const base = kind === 'dark' ? DECKBUILDER_DARK : DECKBUILDER_LIGHT;
  return {
    '--bg': hex(bg),
    '--bg-elev': mix(bg, surface, 0.5),
    '--bg-sunken': kind === 'dark' ? mix(bg, BLACK, 0.2) : mix(bg, border, 0.15),
    '--panel': mix(bg, surface, 0.5),
    '--panel-2': hex(surface),
    '--hover': mix(surface, text, 0.06),
    '--selected': mix(bg, accent, 0.16),
    '--side-active': mix(bg, accent, 0.2),
    '--border': hex(border),
    '--border-soft': mix(border, bg, 0.45),
    '--row-border': mix(border, bg, 0.6),
    '--keycap': hex(border),
    '--text': hex(text),
    '--text-2': mix(text, textDim, 0.5),
    '--text-3': hex(textDim),
    '--accent': hex(accent),
    '--accent-2': mix(accent, text, 0.3),
    '--accent-soft': alpha(accent, 0.14),
    '--ink-on-accent': hex(bg),
    '--ok': hex(green),
    '--ok-soft': alpha(green, 0.13),
    '--warn': hex(yellow),
    '--warn-soft': alpha(yellow, 0.13),
    '--err': hex(red),
    '--err-soft': alpha(red, 0.13),
    '--ink-on-err': '#fff',
    '--info': hex(cyan),
    '--info-soft': alpha(cyan, 0.13),
    '--debug': hex(textDim),
    '--debug-soft': alpha(textDim, 0.13),
    '--muted-soft': alpha(textDim, 0.12),
    '--y-key': hex(accent),
    '--y-str': hex(green),
    '--y-num': hex(orange),
    '--y-bool': hex(purple),
    '--y-comment': hex(textDim),
    '--mark': alpha(yellow, 0.35),
    '--shadow': base['--shadow'],
    '--backdrop': base['--backdrop'],
  };
}

const deck = (id: string, label: string, family: string, kind: ThemeKind, roles: Roles): Palette => ({
  id, label, family, kind, tokens: fromRoles(kind, roles),
});

export const PALETTES: readonly Palette[] = [
  { id: DEFAULT_DARK, label: 'DeckBuilder Dark', family: 'deckbuilder', kind: 'dark', tokens: DECKBUILDER_DARK },
  { id: DEFAULT_LIGHT, label: 'DeckBuilder Light', family: 'deckbuilder', kind: 'light', tokens: DECKBUILDER_LIGHT },
  // Ported from session-deck (crates/sdeck/src/theme.rs).
  deck('tokyo-night', 'Tokyo Night', 'tokyo-night', 'dark', [
    0x1a1b26, 0x24283b, 0x414868, 0xc0caf5, 0x787fa0, 0x7aa2f7, 0xbb9af7, 0x7dcfff, 0x9ece6a, 0xe0af68, 0xff9e64, 0xf7768e]),
  deck('catppuccin-mocha', 'Catppuccin Mocha', 'catppuccin', 'dark', [
    0x1e1e2e, 0x313244, 0x585b70, 0xcdd6f4, 0x7f849c, 0x89b4fa, 0xcba6f7, 0x94e2d5, 0xa6e3a1, 0xf9e2af, 0xfab387, 0xf38ba8]),
  deck('gruvbox-dark', 'Gruvbox Dark', 'gruvbox', 'dark', [
    0x282828, 0x3c3836, 0x665c54, 0xebdbb2, 0xa89984, 0x83a598, 0xd3869b, 0x8ec07c, 0xb8bb26, 0xfabd2f, 0xfe8019, 0xfb4934]),
  deck('nord', 'Nord', 'nord', 'dark', [
    0x2e3440, 0x3b4252, 0x4c566a, 0xd8dee9, 0x7b88a1, 0x81a1c1, 0xb48ead, 0x88c0d0, 0xa3be8c, 0xebcb8b, 0xd08770, 0xbf616a]),
  deck('dracula', 'Dracula', 'dracula', 'dark', [
    0x282a36, 0x44475a, 0x6272a4, 0xf8f8f2, 0x8f9bd0, 0xbd93f9, 0xff79c6, 0x8be9fd, 0x50fa7b, 0xf1fa8c, 0xffb86c, 0xff5555]),
  deck('rose-pine', 'Rose Pine', 'rose-pine', 'dark', [
    0x191724, 0x1f1d2e, 0x403d52, 0xe0def4, 0x908caa, 0xc4a7e7, 0xc4a7e7, 0x9ccfd8, 0x31748f, 0xf6c177, 0xebbcba, 0xeb6f92]),
  deck('solarized-dark', 'Solarized Dark', 'solarized', 'dark', [
    0x002b36, 0x073642, 0x586e75, 0x93a1a1, 0x657b83, 0x268bd2, 0x6c71c4, 0x2aa198, 0x859900, 0xb58900, 0xcb4b16, 0xdc322f]),
  deck('tokyo-night-light', 'Tokyo Night Light', 'tokyo-night', 'light', [
    0xd5d6db, 0xe9e9ec, 0x9699a3, 0x343b58, 0x6a6d7c, 0x34548a, 0x7847bd, 0x166775, 0x485e30, 0x8f5e15, 0x965027, 0x8c4351]),
  deck('catppuccin-latte', 'Catppuccin Latte', 'catppuccin', 'light', [
    0xeff1f5, 0xccd0da, 0xacb0be, 0x4c4f69, 0x6c6f85, 0x1e66f5, 0x8839ef, 0x179299, 0x358021, 0xa8680f, 0xcc4a00, 0xd20f39]),
  deck('gruvbox-light', 'Gruvbox Light', 'gruvbox', 'light', [
    0xfbf1c7, 0xebdbb2, 0xa89984, 0x3c3836, 0x7c6f64, 0x076678, 0x8f3f71, 0x427b58, 0x79740e, 0xb57614, 0xaf3a03, 0x9d0006]),
  deck('rose-pine-dawn', 'Rose Pine Dawn', 'rose-pine', 'light', [
    0xfaf4ed, 0xfffaf3, 0xcecacd, 0x575279, 0x797593, 0x907aa9, 0x907aa9, 0x56949f, 0x286983, 0xb36b00, 0xb85c58, 0xb4637a]),
  deck('solarized-light', 'Solarized Light', 'solarized', 'light', [
    0xfdf6e3, 0xeee8d5, 0x93a1a1, 0x586e75, 0x78898b, 0x268bd2, 0x6c71c4, 0x1d8a82, 0x6f8000, 0x9d7500, 0xcb4b16, 0xdc322f]),
  deck('alucard', 'Alucard', 'dracula', 'light', [
    0xfffbeb, 0xece6d0, 0xc8c2a8, 0x1f1f1f, 0x6c664b, 0x644ac9, 0xa3144d, 0x036a96, 0x14710a, 0x846e15, 0xa34d14, 0xcb3a2a]),
];

export function paletteById(id: string | undefined): Palette | undefined {
  return id ? PALETTES.find((p) => p.id === id) : undefined;
}

/** The palette of `id`'s family with that kind, if the family has one. */
export function familySibling(id: string, kind: ThemeKind): Palette | undefined {
  const p = paletteById(id);
  return p && PALETTES.find((q) => q.family === p.family && q.kind === kind);
}

/**
 * The palette a saved `id` names, if it is one of `kind`; else the `kind` take on the family of the
 * other side's saved palette (`dracula` → `alucard`); else that kind's default.
 */
export function resolvePalette(kind: ThemeKind, id?: string, otherSideId?: string): Palette {
  const own = paletteById(id);
  if (own?.kind === kind) return own;
  return (otherSideId && familySibling(otherSideId, kind)) || paletteById(kind === 'dark' ? DEFAULT_DARK : DEFAULT_LIGHT)!;
}

export function effectiveKind(pref: ThemePreference, systemKind: ThemeKind): ThemeKind {
  return pref === 'system' ? systemKind : pref;
}

/** The palette to show; `systemKind` (the OS light/dark setting) only matters for `theme: 'system'`. */
export function paletteFor(settings: ThemeSettings, systemKind: ThemeKind): Palette {
  return effectiveKind(settings.theme, systemKind) === 'dark'
    ? resolvePalette('dark', settings.paletteDark, settings.paletteLight)
    : resolvePalette('light', settings.paletteLight, settings.paletteDark);
}
