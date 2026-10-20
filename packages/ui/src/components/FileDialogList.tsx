import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { rovingIndex, useRovingList } from '../roving-list';
import { visibleRange } from '../table';
import { formatBytes } from './StatusBar';
import { Icon } from './ui';

export interface FileDialogEntry {
  name: string;
  kind: 'file' | 'dir' | 'link';
  size: number;
  mtime: number;
  hidden?: boolean;
}

/** Up to this many rows the list renders them all (browser roving focus); above it only the visible window. */
export const WINDOW_THRESHOLD = 500;
const ROW_HEIGHT = 28;
const TYPE_AHEAD_MS = 700;
const NO_REF: RefObject<HTMLElement | null> = { current: null };

interface Props {
  entries: FileDialogEntry[];
  /** Enter or double-click on a row. */
  onActivate(entry: FileDialogEntry): void;
  /** Click or focus on a row. */
  onSelect(entry: FileDialogEntry): void;
  /** Changes with the folder: resets the scroll and the active row. */
  resetKey: string;
}

/** The file dialog's folder list: roving focus up to 500 rows, a windowed index-based list above. */
export function FileDialogList({ entries, onActivate, onSelect, resetKey }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const windowed = entries.length > WINDOW_THRESHOLD;
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const focusAfter = useRef(false);
  const typed = useRef({ text: '', at: 0 });

  useRovingList(windowed ? NO_REF : scroller, '.fd-row');

  useLayoutEffect(() => {
    setActive(0);
    setScrollTop(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [resetKey]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport(el.clientHeight);
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const reveal = (index: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = index * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    setScrollTop(el.scrollTop);
  };

  const goTo = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    setActive(index);
    onSelect(entry);
    if (windowed) {
      reveal(index);
      focusAfter.current = true;
    } else {
      const row = scroller.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
      row?.focus();
    }
  };

  useEffect(() => {
    if (!focusAfter.current) return;
    focusAfter.current = false;
    scroller.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus({ preventScroll: true });
  });

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length === 1 && e.key !== ' ') {
      const now = Date.now();
      const state = typed.current;
      state.text = now - state.at > TYPE_AHEAD_MS ? e.key : state.text + e.key;
      state.at = now;
      const needle = state.text.toLowerCase();
      const from = state.text.length === 1 ? active + 1 : active;
      const order = [...entries.keys()].map((i) => (i + from) % entries.length);
      const hit = order.find((i) => entries[i]!.name.toLowerCase().startsWith(needle));
      if (hit !== undefined) {
        e.preventDefault();
        goTo(hit);
      }
      return;
    }
    if (!windowed) return;
    const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT));
    const next = rovingIndex(e.key, active, entries.length, page);
    if (next === null) return;
    e.preventDefault();
    goTo(next);
  };

  const { start, end } = windowed ? visibleRange(scrollTop, viewport, ROW_HEIGHT, entries.length) : { start: 0, end: entries.length };

  return (
    <div
      ref={scroller}
      className="fd-list"
      role="listbox"
      aria-label={t('fileDialog.name')}
      onKeyDown={onKeyDown}
      onScroll={windowed ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
    >
      <div className="fd-head" aria-hidden="true">
        <span>{t('fileDialog.name')}</span>
        <span>{t('fileDialog.size')}</span>
        <span>{t('fileDialog.modified')}</span>
      </div>
      {windowed && <div style={{ height: start * ROW_HEIGHT }} />}
      {entries.slice(start, end).map((entry, offset) => {
        const index = start + offset;
        return (
          <div
            key={entry.name}
            className={`fd-row${entry.hidden ? ' dim' : ''}${index === active ? ' selected' : ''}`}
            role="option"
            aria-selected={index === active}
            data-index={index}
            style={{ height: ROW_HEIGHT }}
            tabIndex={windowed ? (index === active ? 0 : -1) : undefined}
            onFocus={() => {
              setActive(index);
              onSelect(entry);
            }}
            onClick={() => {
              setActive(index);
              onSelect(entry);
            }}
            onDoubleClick={() => onActivate(entry)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onActivate(entry);
              }
            }}
          >
            <span className="fd-name">
              <Icon name={entry.kind === 'dir' ? 'folder' : 'file'} />
              <span className="fd-label">{entry.name}</span>
            </span>
            <span className="fd-num">{entry.kind === 'file' ? formatBytes(entry.size) : ''}</span>
            <span className="fd-date">{entry.mtime ? new Date(entry.mtime).toLocaleString() : ''}</span>
          </div>
        );
      })}
      {windowed && <div style={{ height: (entries.length - end) * ROW_HEIGHT }} />}
    </div>
  );
}
