import { type RefObject, useEffect, useRef } from 'react';

/** Index a list key moves to from `current` among `count` items (`page` = items per page), or null for other keys. */
export function rovingIndex(key: string, current: number, count: number, page: number): number | null {
  if (count <= 0) return null;
  const step = Math.max(1, page);
  const clamp = (i: number) => Math.min(count - 1, Math.max(0, i));
  switch (key) {
    case 'ArrowUp': return clamp(current - 1);
    case 'ArrowDown': return clamp(current + 1);
    case 'Home': return 0;
    case 'End': return count - 1;
    case 'PageUp': return clamp(current - step);
    case 'PageDown': return clamp(current + step);
    default: return null;
  }
}

export interface RovingListOptions {
  /**
   * Selector of an item's controls. When set, Enter or F2 on a focused item focuses its first control, and Escape
   * inside an item (not handled by anyone else) returns focus to the item.
   */
  control?: string;
}

/**
 * Keyboard list navigation over the items (`itemSelector`) under `container`, like VS Code's settings list: a roving
 * tabindex (one Tab enters the list, one leaves it), Up/Down/Home/End/PageUp/PageDown on a focused item, and focus
 * anywhere inside an item makes it the current one. Arrow keys inside an item's controls keep their own behavior.
 */
export function useRovingList(container: RefObject<HTMLElement | null>, itemSelector: string, options: RovingListOptions = {}): void {
  const { control } = options;
  const attached = useRef<{ root: HTMLElement; key: string; detach: () => void } | null>(null);
  // Every commit: the container may mount later (e.g. after loading) or be swapped.
  useEffect(() => {
    const root = container.current;
    const key = `${itemSelector}|${control ?? ''}`;
    const was = attached.current;
    if (was?.root === root && was?.key === key) return;
    was?.detach();
    attached.current = root ? { root, key, detach: attachRovingList(root, itemSelector, control) } : null;
  });
  useEffect(() => () => {
    attached.current?.detach();
    attached.current = null;
  }, []);
}

function attachRovingList(root: HTMLElement, itemSelector: string, control: string | undefined): () => void {
  const doc = root.ownerDocument;
  let current: HTMLElement | null = null;
  const items = () => Array.from(root.querySelectorAll<HTMLElement>(itemSelector));
  const sync = () => {
    const list = items();
    if (!current || !list.includes(current)) current = list[0] ?? null;
    for (const item of list) {
      const tab = item === current ? 0 : -1;
      if (item.tabIndex !== tab || !item.hasAttribute('tabindex')) item.tabIndex = tab;
    }
  };
  const itemOf = (target: EventTarget | null) => {
    const item = target instanceof Element ? target.closest<HTMLElement>(itemSelector) : null;
    return item && root.contains(item) ? item : null;
  };
  const onFocusIn = (e: FocusEvent) => {
    const item = itemOf(e.target);
    if (!item || item === current) return;
    current = item;
    sync();
  };
  // On the document so handlers of the item's controls (React's, at the app root) run first.
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const item = itemOf(e.target);
    if (!item) return;
    if (e.target !== item) {
      if (control && e.key === 'Escape') {
        e.preventDefault();
        item.focus();
      }
      return;
    }
    if (control && (e.key === 'Enter' || e.key === 'F2')) {
      const first = item.querySelector<HTMLElement>(control);
      if (!first) return;
      e.preventDefault();
      first.focus();
      return;
    }
    const list = items();
    const page = Math.max(1, Math.floor(root.clientHeight / Math.max(1, item.offsetHeight)));
    const next = rovingIndex(e.key, list.indexOf(item), list.length, page);
    if (next === null) return;
    e.preventDefault();
    const target = list[next]!;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'nearest' });
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener('focusin', onFocusIn);
  doc.addEventListener('keydown', onKey);
  return () => {
    observer.disconnect();
    root.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('keydown', onKey);
  };
}
