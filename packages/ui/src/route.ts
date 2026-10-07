import { useEffect, useState } from 'react';

// Hash routing (#/home, #/settings): works with the file-less SPA fallback and survives reloads.

function parse<Id extends string>(hash: string, ids: readonly Id[], fallback: Id): Id {
  const id = hash.replace(/^#\/?/, '');
  return (ids as readonly string[]).includes(id) ? (id as Id) : fallback;
}

/** Current screen from the URL hash, and a function that navigates to another one. */
export function useHashRoute<Id extends string>(ids: readonly Id[], fallback: Id): [Id, (id: Id) => void] {
  const [screen, setScreen] = useState(() => parse(window.location.hash, ids, fallback));
  useEffect(() => {
    const onHash = () => setScreen(parse(window.location.hash, ids, fallback));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [ids, fallback]);
  return [screen, (id) => { window.location.hash = `/${id}`; }];
}
