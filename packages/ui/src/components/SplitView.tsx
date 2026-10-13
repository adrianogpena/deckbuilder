import { Children, Fragment, useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clampSizes, dragDivider } from '../split';

const KEY_STEP = 0.02;

export interface SplitViewProps {
  direction: 'row' | 'column';
  /** Fractions of the container, one per child; a length other than the child count gives an equal split. */
  sizes: number[];
  /** Sizes a double-click on a divider resets to; equal split when omitted. */
  defaultSizes?: number[];
  /** Minimum pixels per pane; 120 when omitted. */
  min?: number[];
  /** New fractions after a drag, a key or a container resize; persist them with `useDebouncedSave`. */
  onResize: (sizes: number[]) => void;
  children: ReactNode;
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);

/**
 * Panes side by side (row) or stacked (column) with a draggable divider between each pair.
 * Panes are keyed by their child's key, so a keyed child stays mounted when another is added or removed.
 */
export function SplitView({ direction, sizes, defaultSizes, min = [], onResize, children }: SplitViewProps) {
  const panes = Children.toArray(children);
  const valid = sizes.length === panes.length;
  const current = valid ? sizes : panes.map(() => 1 / panes.length);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; start: number; sizes: number[]; total: number }>();
  const latest = useRef({ sizes, valid, min, onResize });
  latest.current = { sizes, valid, min, onResize };
  const row = direction === 'row';

  // Pixels shared by the panes: the container minus the dividers.
  const totalPx = () => {
    const el = box.current;
    if (!el) return 0;
    let total = 0;
    for (const child of Array.from(el.children)) {
      if (child.classList.contains('split-pane')) total += row ? (child as HTMLElement).offsetWidth : (child as HTMLElement).offsetHeight;
    }
    return total;
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const l = latest.current;
      if (!l.valid) return;
      const next = clampSizes(l.sizes, l.min, totalPx());
      if (!same(next, l.sizes)) l.onResize(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
    // Deps are deliberately partial.
  }, [row]);

  const move = (index: number, deltaPx: number) => {
    const total = totalPx();
    const next = dragDivider(clampSizes(current, min, total), index, deltaPx, total, min);
    if (!same(next, current)) onResize(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    const total = totalPx();
    drag.current = { index, start: row ? e.clientX : e.clientY, sizes: clampSizes(current, min, total), total };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = dragDivider(d.sizes, d.index, (row ? e.clientX : e.clientY) - d.start, d.total, min);
    if (!same(next, latest.current.sizes)) onResize(next);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = undefined;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, index: number) => {
    const total = totalPx();
    const step = KEY_STEP * total;
    const back = row ? 'ArrowLeft' : 'ArrowUp';
    const forward = row ? 'ArrowRight' : 'ArrowDown';
    const delta = e.key === back ? -step : e.key === forward ? step : e.key === 'Home' ? -total : e.key === 'End' ? total : 0;
    if (!delta) return;
    e.preventDefault();
    move(index, delta);
  };

  const reset = () => {
    const base = defaultSizes?.length === panes.length ? defaultSizes : panes.map(() => 1 / panes.length);
    const next = clampSizes(base, min, totalPx());
    if (!same(next, current)) onResize(next);
  };

  return (
    <div ref={box} className={`split split-${direction}`}>
      {panes.map((child, i) => {
        const key = (child as { key?: string | null }).key ?? i;
        return (
          <Fragment key={key}>
            {i > 0 && (
              <div
                className="split-divider"
                role="separator"
                aria-orientation={row ? 'vertical' : 'horizontal'}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(current[i - 1] * 100)}
                tabIndex={0}
                onPointerDown={(e) => onPointerDown(e, i - 1)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(e) => onKeyDown(e, i - 1)}
                onDoubleClick={reset}
              />
            )}
            <div className="split-pane" style={{ flex: `${current[i]} 1 0px` }}>
              {child}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
