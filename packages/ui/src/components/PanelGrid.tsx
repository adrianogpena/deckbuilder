import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import {
  BREAKPOINTS,
  COLS,
  ROW_HEIGHT,
  breakpointOf,
  fromGridLayout,
  sameGeometry,
  toGridLayout,
  type GridItem,
  type PanelDef,
} from '../grid';
import { Icon } from './ui';
import { PANEL_HANDLE, PANEL_NO_DRAG, PanelFrame } from './Panel';

const MARGIN = [12, 12] as const;

export interface PanelGridProps {
  items: GridItem[];
  defs: PanelDef[];
  /** Content of one panel; the grid adds the frame (title, icon, collapse, remove). */
  render: (id: string) => ReactNode;
  /** Called with the new items after a drag, resize, collapse or remove. */
  onChange: (items: GridItem[]) => void;
}

/**
 * Draggable, resizable panels. Only the full-width (lg) layout is editable and saved; the
 * narrower breakpoints show a layout the grid derives from it.
 */
export function PanelGrid({ items, defs, render, onChange }: PanelGridProps) {
  const { width, containerRef } = useContainerWidth({ initialWidth: 1280 });
  const editable = breakpointOf(width) === 'lg';
  const known = useMemo(() => items.filter((i) => defs.some((d) => d.id === i.id)), [items, defs]);
  const layout = useMemo(() => toGridLayout(known, defs), [known, defs]);
  const latest = useRef(items);
  latest.current = items;

  const commitLayout = (next: Layout) => {
    if (!editable) return;
    const current = latest.current;
    const merged = fromGridLayout(next, current);
    if (!sameGeometry(merged, current)) onChange(merged);
  };

  const patch = (id: string, change: Partial<GridItem>) =>
    onChange(items.map((i) => (i.id === id ? { ...i, ...change } : i)));

  return (
    <div ref={containerRef as RefObject<HTMLDivElement>} className="panel-grid">
      <ResponsiveGridLayout
        width={width}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        layouts={{ lg: layout, md: layout, sm: layout }}
        rowHeight={ROW_HEIGHT}
        margin={MARGIN}
        compactor={verticalCompactor}
        dragConfig={{ enabled: editable, handle: `.${PANEL_HANDLE}`, cancel: `.${PANEL_NO_DRAG}` }}
        resizeConfig={{ enabled: editable }}
        onDragStop={commitLayout}
        onResizeStop={commitLayout}
      >
        {known.map((item) => {
          const def = defs.find((d) => d.id === item.id)!;
          return (
            <div key={item.id}>
              <PanelFrame
                title={def.title}
                icon={<Icon name={def.icon} />}
                collapsed={!!item.collapsed}
                onCollapsedChange={(collapsed) => patch(item.id, { collapsed })}
                onRemove={() => onChange(items.filter((i) => i.id !== item.id))}
              >
                {render(item.id)}
              </PanelFrame>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
