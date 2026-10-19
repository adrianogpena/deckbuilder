import { useEffect, useRef, useState } from 'react';
import { isDockableKind } from './registry';
import { loadRightSideMap, saveRightSide } from '../api';
import { parseRightSide } from './right-side-store';
import type { PanelKind } from './types';

/**
 * The right sidebar state of one scope, restored from the server after the first fetch resolves.
 * Saved `open` wins over `defaultOpen`; nothing is saved before the load finished or before the state changes.
 */
export function useRightSide(scope: string, defaultOpen: boolean) {
  const [list, setList] = useState<PanelKind[]>([]);
  const [open, setOpen] = useState(defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const baseline = useRef<string>();
  const defaultRef = useRef(defaultOpen);
  defaultRef.current = defaultOpen;

  useEffect(() => {
    let live = true;
    baseline.current = undefined;
    setLoaded(false);
    void loadRightSideMap().then((map) => {
      if (!live) return;
      const saved = parseRightSide(map, scope, isDockableKind);
      setList(saved.list);
      setOpen(saved.open ?? defaultRef.current);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [scope]);

  useEffect(() => {
    if (!loaded) return;
    const key = JSON.stringify([list, open]);
    if (baseline.current === undefined) {
      baseline.current = key;
      return;
    }
    if (baseline.current === key) return;
    baseline.current = key;
    saveRightSide(scope, { list, open });
  }, [loaded, scope, list, open]);

  return { list, setList, open, setOpen };
}
