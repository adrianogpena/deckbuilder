import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLayout } from './layout';
import { layoutPick } from './design-picks';

/** Design-preview run (`bun run dev:design`): variants, the switcher and placeholder controls render only when this is true. */
export const designOn: boolean = Boolean((import.meta as { env?: Record<string, unknown> }).env?.VITE_KEDALION_DESIGN);

/** A = command-first, B = dockable canvas, C = focus + inspector; `current` is today's design. */
export type DesignVariant = 'current' | 'a' | 'b' | 'c';
export const DESIGN_VARIANTS: readonly DesignVariant[] = ['current', 'a', 'b', 'c'];
export const DESIGN_NAMES: Record<DesignVariant, string> = { current: 'Current', a: 'A · Command-first', b: 'B · Dockable canvas', c: 'C · Focus + inspector' };

const KEY = (view: string) => `kedalion.design.${view}`;
const EVENT = 'kedalion:design';

const read = (view: string): DesignVariant | null => {
  try {
    const v = window.localStorage.getItem(KEY(view));
    return DESIGN_VARIANTS.includes(v as DesignVariant) ? (v as DesignVariant) : null;
  } catch { return null; }
};
const write = (view: string, v: DesignVariant | null) => {
  try { if (v) window.localStorage.setItem(KEY(view), v); else window.localStorage.removeItem(KEY(view)); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event(EVENT));
};

/** The chosen variant of a view: with the design flag its own override, else the global direction (`global`); then the active layout's pick (Cockpit), else `current`. `layoutId` overrides the layout from context (App, outside the provider). */
export function useDesign(view: string, layoutId?: string): DesignVariant {
  const ctxLayout = useLayout().layout.id;
  const picked = layoutPick(layoutId ?? ctxLayout, view);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!designOn) return;
    const on = () => tick((n) => n + 1);
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', on); };
  }, []);
  if (!designOn) return picked;
  return read(view) ?? read('global') ?? picked;
}


/** Floating chip under the design flag: the global direction plus a per-view override for each name in `views`. */
export function DesignSwitcher({ views, current }: { views: readonly string[]; current?: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const set = useCallback((view: string, v: DesignVariant | null) => write(view, v), []);
  const global = useDesign('global');
  if (!designOn) return null;
  const shown = current ? [current] : views;
  return (
      <div className="design-switcher" role="group" aria-label="Design preview">
        <button type="button" className="design-switcher-chip" aria-expanded={open} onClick={() => setOpen(!open)}>Design · {DESIGN_NAMES[global].split(' ·')[0]}</button>
        {open && (
          <div className="design-switcher-pop">
            <div className="design-switcher-row">
              <span className="mono-label">All</span>
              {DESIGN_VARIANTS.map((v) => (
                <button type="button" key={v} className="design-switcher-opt" aria-pressed={global === v} title={DESIGN_NAMES[v]} onClick={() => { for (const w of views) write(w, null); set('global', v); }}>{v === 'current' ? 'Cur' : v.toUpperCase()}</button>
              ))}
            </div>
            {shown.map((view) => {
              const own = read(view);
              return (
                <div className="design-switcher-row" key={view}>
                  <span className="mono-label">{view}</span>
                  {DESIGN_VARIANTS.map((v) => (
                    <button type="button" key={v} className="design-switcher-opt" aria-pressed={(own ?? global) === v} title={DESIGN_NAMES[v]} onClick={() => set(view, v)}>{v === 'current' ? 'Cur' : v.toUpperCase()}</button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
  );
}
