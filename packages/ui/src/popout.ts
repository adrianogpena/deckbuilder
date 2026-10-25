import { useEffect, useState } from 'react';
import { isDesktop, request } from './api';

/** The view id this window was popped out for, or undefined in the main window. */
export function popoutView(): string | undefined {
  return (window as { __KEDALION_POPOUT__?: string }).__KEDALION_POPOUT__ || undefined;
}

/** Opens a native window for `view`, or brings its existing one to the front; false when unsupported. */
export async function popOut(view: string, title: string): Promise<boolean> {
  try {
    const res = await request<{ ok: boolean }>('POST', '/api/window/popout', {}, { view, title });
    return res.ok;
  } catch {
    return false;
  }
}

const POLL_MS = 1500;
const NONE: ReadonlySet<string> = new Set();

/** Views currently popped out. Unsupported (no polling) in a browser and inside a pop-out. */
export function usePopouts(): { supported: boolean; views: ReadonlySet<string> } {
  const active = isDesktop && popoutView() === undefined;
  const [state, setState] = useState<{ supported: boolean; views: ReadonlySet<string> }>({ supported: false, views: NONE });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await request<{ supported: boolean; views: string[] }>('GET', '/api/window/popouts');
        if (!alive) return;
        setState((prev) => (prev.supported === res.supported && sameViews(prev.views, res.views) ? prev : { supported: res.supported, views: new Set(res.views) }));
      } catch {
        // keep the last state
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    window.addEventListener('focus', poll);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, [active]);
  return active ? state : { supported: false, views: NONE };
}

function sameViews(a: ReadonlySet<string>, b: string[]): boolean {
  return a.size === b.length && b.every((v) => a.has(v));
}
