import { useEffect, useRef } from 'react';
import { effectiveKeys, type TabAction, useKeybindings } from '@kedalion/ui';

/** The first key of a command, for tooltips and menus. */
export function useChordOf(): (id: string) => string | undefined {
  const kb = useKeybindings();
  const keys = kb ? effectiveKeys(kb.defs, kb.keymap) : undefined;
  return (id) => keys?.get(id)?.[0];
}

/** Calls `onActions` after every render (the tab bar ignores unchanged lists) and clears them on unmount. */
export function useTabActions(actions: TabAction[], onActions?: (actions: TabAction[]) => void) {
  const ref = useRef(onActions);
  ref.current = onActions;
  useEffect(() => ref.current?.(actions));
  useEffect(() => () => ref.current?.([]), []);
}
