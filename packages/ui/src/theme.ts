import { useEffect, useState } from 'react';
import { paletteFor, TOKENS, type Palette, type ThemeKind, type ThemeSettings } from '@deckbuilder/server-core/palettes';

const QUERY = '(prefers-color-scheme: dark)';

/** The OS light/dark setting, live. */
export function useSystemKind(): ThemeKind {
  const [kind, setKind] = useState<ThemeKind>(() => (window.matchMedia(QUERY).matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const listener = (e: MediaQueryListEvent) => setKind(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', listener);
    setKind(mq.matches ? 'dark' : 'light');
    return () => mq.removeEventListener('change', listener);
  }, []);
  return kind;
}

/** Applies the palette the settings name: `data-theme` and every token as an inline property on `<html>`. */
export function useTheme(settings: ThemeSettings): { kind: ThemeKind; palette: Palette } {
  const systemKind = useSystemKind();
  const palette = paletteFor(settings, systemKind);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = palette.kind;
    for (const token of TOKENS) root.style.setProperty(token, palette.tokens[token]);
  }, [palette]);
  return { kind: palette.kind, palette };
}

/** Sets the app window's zoom (`settings.zoom`); a no-op in a browser tab. */
export function useZoom(zoom: number | undefined): void {
  useEffect(() => {
    (window as { __deckbuilderSetZoom?: (factor: number) => void }).__deckbuilderSetZoom?.(zoom ?? 1);
  }, [zoom]);
}
