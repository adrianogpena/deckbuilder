import { useEffect, useState } from 'react';

// Hash routing (#/home, #/settings): works with the file-less SPA fallback and survives reloads.
export const SCREENS = ['home', 'settings'] as const;
export type ScreenId = (typeof SCREENS)[number];

export const DEFAULT_SCREEN: ScreenId = 'home';

function parse(hash: string): ScreenId {
  const id = hash.replace(/^#\/?/, '');
  return (SCREENS as readonly string[]).includes(id) ? (id as ScreenId) : DEFAULT_SCREEN;
}

export function useScreen(): [ScreenId, (id: ScreenId) => void] {
  const [screen, setScreen] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onHash = () => setScreen(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [screen, (id) => { window.location.hash = `/${id}`; }];
}
