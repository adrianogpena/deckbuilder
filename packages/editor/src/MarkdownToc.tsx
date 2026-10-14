import { rovingIndex, t } from '@deckbuilder/ui';
import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { activeHeading } from './toc';

/** A rendered h1–h3, kept by reference: the sanitizer strips ids, so there is nothing to link to. */
export interface TocHeading {
  el: HTMLElement;
  level: number;
  text: string;
}

/** Tick width per heading level (h1, h2, h3). */
const TICK = [20, 14, 8];
/** Vertical distance between ticks; matches `.md-toc-tick` height plus margin. */
const GAP = 8;
/** A heading this close below the container's top already counts as the one being read. */
const SPY_OFFSET = 16;
/** Where a jumped-to heading lands below the container's top. */
const JUMP_OFFSET = 8;

/** The nearest ancestor that scrolls vertically. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/** A rail of heading ticks pinned to the left of the rendered markdown, with scroll-spy; a click lists the headings. */
export function MarkdownToc({ headings, content }: { headings: TocHeading[]; content: RefObject<HTMLElement | null> }) {
  const root = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const shown = headings.length >= 2;

  useEffect(() => {
    const box = scrollParent(root.current);
    if (!box || !shown) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = box.getBoundingClientRect().top;
      const tops = headings.map((h) => h.el.getBoundingClientRect().top - top);
      const atBottom = box.scrollHeight > box.clientHeight && box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
      setActive(Math.max(0, activeHeading(tops, SPY_OFFSET, atBottom)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    box.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(box);
    if (content.current) resize.observe(content.current);
    return () => {
      box.removeEventListener('scroll', schedule);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [headings, content, shown]);

  useEffect(() => {
    if (!open) return;
    const list = panel.current;
    const item = list?.querySelector<HTMLButtonElement>('.md-toc-item.active');
    if (list && item) {
      list.scrollTop = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2;
      item.focus({ preventScroll: true });
    }
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  if (!shown) return null;

  const close = () => {
    setOpen(false);
    rail.current?.focus({ preventScroll: true });
  };

  const jump = (h: TocHeading) => {
    close();
    const box = scrollParent(root.current);
    if (!box) return;
    const top = box.scrollTop + h.el.getBoundingClientRect().top - box.getBoundingClientRect().top - JUMP_OFFSET;
    box.scrollTo({ top, behavior: 'smooth' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('.md-toc-item') ?? [])];
    const next = rovingIndex(e.key, items.indexOf(document.activeElement as HTMLButtonElement), items.length, 10);
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  };

  return (
    <div ref={root} className="md-toc" onKeyDown={onKeyDown}>
      <button ref={rail} type="button" className="md-toc-rail" aria-expanded={open} aria-label={t('preview.toc')} title={t('preview.toc')}
        onClick={() => setOpen(!open)}>
        {headings.map((h, i) => (
          <span key={i} className={'md-toc-tick' + (i === active ? ' active' : '')} style={{ width: TICK[h.level - 1] }} />
        ))}
        <span className="md-toc-indicator" style={{ transform: `translateY(${active * GAP}px)` }} />
      </button>
      {open && (
        <nav ref={panel} className="md-toc-panel" aria-label={t('preview.toc')}>
          <ul>
            {headings.map((h, i) => (
              <li key={i}>
                <button type="button" className={'md-toc-item' + (i === active ? ' active' : '')} aria-current={i === active ? 'location' : undefined}
                  style={{ paddingLeft: 10 + (h.level - 1) * 12 }} onClick={() => jump(h)}>
                  {h.text}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
