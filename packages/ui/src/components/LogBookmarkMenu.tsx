import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { firstLineAtOrAfter, isStale, type LogBookmark, type LogLine, MAX_LABEL_CHARS } from '../log';
import { Button, IconButton } from './Button';
import { Icon, useDialogs } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
export const clock = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const same = (a: LogBookmark) => (b: LogBookmark) => a.at === b.at && a.offset === b.offset;

interface LogBookmarkMenuProps {
  bookmarks: LogBookmark[];
  onBookmarksChange(bookmarks: LogBookmark[]): void;
  lines: LogLine[];
  endOffset?: number;
  /** Scrolls the view to the bookmark's marker. */
  onGoTo(bookmark: LogBookmark): void;
  onCopyFrom?(bookmark: LogBookmark): void;
  onSaveFrom?(bookmark: LogBookmark): void;
}

/** The bookmark dropdown of a `LogView`: list newest first, rename, go to, copy/save to the end, delete. */
export function LogBookmarkMenu({ bookmarks, onBookmarksChange, lines, endOffset, onGoTo, onCopyFrom, onSaveFrom }: LogBookmarkMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const latest = useRef(bookmarks);
  latest.current = bookmarks;
  const { prompt, element: dialogElement } = useDialogs();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.modal-backdrop')) setOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const windowStart = lines[0]?.offset ?? endOffset ?? 0;
  const sorted = useMemo(() => [...bookmarks].sort((a, b) => b.at - a.at), [bookmarks]);
  const newest = sorted[0];
  const sinceNewest = (() => {
    if (!newest || isStale(newest, endOffset) || newest.offset < windowStart) return null;
    const i = firstLineAtOrAfter(lines, newest.offset);
    if (i < 0) return 0;
    return lines.length - i - (lines.at(-1)?.partial ? 1 : 0);
  })();

  const rename = async (b: LogBookmark) => {
    const label = await prompt({
      title: t('log.rename'),
      label: t('log.renameLabel'),
      value: b.label,
      validate: (v) => (!v.trim() ? t('log.labelEmpty') : v.trim().length > MAX_LABEL_CHARS ? t('log.labelTooLong', { max: MAX_LABEL_CHARS }) : null),
    });
    if (label === null) return;
    onBookmarksChange(latest.current.map((x) => (same(b)(x) ? { ...x, label: label.trim() } : x)));
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <Button size="sm" icon="bookmark" title={t('log.bookmarks')} aria-expanded={open} onClick={() => setOpen(!open)}>
        {t('log.bookmarks')} <span className="log-level-count">{bookmarks.length}</span> <Icon name="chevron-down" size={12} />
      </Button>
      {open && (
        <div className="menu log-bookmarks" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {sorted.length === 0 && <div className="log-bm-empty">{t('log.noBookmarks')}</div>}
          {newest && sinceNewest !== null && <div className="log-bm-since">{t('log.linesAfter', { count: sinceNewest, label: newest.label })}</div>}
          {sorted.map((b) => {
            const stale = isStale(b, endOffset);
            const hidden = stale || b.offset < windowStart;
            return (
              <div key={`${b.at}-${b.offset}`} className={`log-bm${stale ? ' stale' : ''}`}>
                <div className="log-bm-head">
                  <button className="log-bm-label" title={t('log.rename')} onClick={() => void rename(b)}>{b.label}</button>
                  <span className="log-bm-time">{clock(b.at)}</span>
                </div>
                {stale ? <div className="log-bm-hint">{t('log.stale')}</div> : b.preview && <div className="log-bm-preview">{b.preview}</div>}
                <div className="log-bm-actions">
                  <Button variant="ghost" size="xs" icon="forward" title={t('log.goTo')} disabled={hidden} onClick={() => { setOpen(false); onGoTo(b); }}>
                    {t('log.goTo')}
                  </Button>
                  {onCopyFrom && (
                    <Button variant="ghost" size="xs" icon="copy" title={t('log.copyToEnd')} disabled={stale} onClick={() => onCopyFrom(b)}>
                      {t('log.copyToEnd')}
                    </Button>
                  )}
                  {onSaveFrom && (
                    <Button variant="ghost" size="xs" icon="download" title={t('log.saveToEnd')} disabled={stale} onClick={() => onSaveFrom(b)}>
                      {t('log.saveToEnd')}
                    </Button>
                  )}
                  <span className="spacer" />
                  <IconButton size="xs" icon="trash" label={t('log.delete')} onClick={() => onBookmarksChange(bookmarks.filter((x) => !same(b)(x)))} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      {dialogElement}
    </div>
  );
}
