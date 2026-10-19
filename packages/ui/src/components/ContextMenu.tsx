import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { IconName } from '../icons';
import { Icon } from './ui';

const EDGE = 4;

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: IconName;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Makes the item a check item (or a radio item with `radio`): a check or dot shows when true. */
  checked?: boolean;
  radio?: boolean;
  run(): void;
}

/**
 * Menu at a point (usually the mouse position of a contextmenu event), kept inside the viewport.
 * Escape, a mousedown outside, scrolling or the window losing focus close it.
 */
export function ContextMenu({ at, items, onClose }: { at: { x: number; y: number }; items: Array<ContextMenuItem | 'sep'>; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Read on the first render, before the first item takes the focus.
  const previous = useRef(document.activeElement);

  useLayoutEffect(() => {
    const el = menu.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(EDGE, Math.min(at.x, window.innerWidth - width - EDGE)),
      y: Math.max(EDGE, Math.min(at.y, window.innerHeight - height - EDGE)),
    });
    el.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
  }, [at.x, at.y]);

  useEffect(() => {
    const close = () => closeRef.current();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      // Unless an item moved the focus elsewhere (the removed menu leaves it on body).
      const prev = previous.current;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && prev instanceof HTMLElement && prev.isConnected) prev.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? []);
    if (!buttons.length) return;
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (e.key === 'ArrowDown') next = (idx + 1) % buttons.length;
    else if (e.key === 'ArrowUp') next = (idx - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'Tab') next = idx;
    else return;
    e.preventDefault();
    buttons[next]?.focus();
  };

  return createPortal(
    <div ref={menu} className="context-menu" role="menu" style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={`sep-${i}`} className="menu-sep" role="separator" />
        ) : (
          <button title={item.label}
            key={item.id}
            className={`menu-item${item.danger ? ' danger' : ''}`}
            role={item.checked === undefined ? 'menuitem' : item.radio ? 'menuitemradio' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span className="menu-icon">
              {item.checked ? (item.radio ? <span className="menu-radio" /> : <Icon name="check" size={14} />) : item.icon && <Icon name={item.icon} size={15} />}
            </span>
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
