import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { copyText } from '../hooks';
import { t } from '../i18n';
import {
  addBookmark,
  addHighlight,
  filterLines,
  type HighlightTerm,
  lineIndexAt,
  levelCounts,
  LOG_LEVELS,
  type LogBookmark,
  type LogLevel,
  type LogLine,
  type LogQuery,
  matcher,
  matcherError,
  matchIndexes,
  MAX_HIGHLIGHTS,
  MAX_PREVIEW_CHARS,
  segments,
  withMarkers,
} from '../log';
import { visibleRange } from '../table';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { Icon } from './ui';
import { wordUnder } from '../log-dom';
import { clock, LogBookmarkMenu } from './LogBookmarkMenu';
import { LogHighlightBar } from './LogHighlightBar';

const MENU_WORD_CHARS = 40;

export interface LogViewProps {
  lines: LogLine[];
  highlights: HighlightTerm[];
  onHighlightsChange(terms: HighlightTerm[]): void;
  /** With `onFollowChange`: shows the follow toggle; following keeps the view at the bottom. */
  follow?: boolean;
  onFollowChange?(follow: boolean): void;
  /** With `onBookmarksChange`: shows the bookmark controls and markers. */
  bookmarks?: LogBookmark[];
  onBookmarksChange?(bookmarks: LogBookmark[]): void;
  /** Byte offset the lines were read up to; "Bookmark EOF" is hidden without it. */
  endOffset?: number;
  onCopyFrom?(bookmark: LogBookmark): void;
  onSaveFrom?(bookmark: LogBookmark): void;
  /** Pixels; fixed, since the view windows its rows. 20 when omitted. */
  rowHeight?: number;
}

const isLine = (row: LogLine | LogBookmark): row is LogLine => 'n' in row;
/**
 * A log viewer: virtualized lines colored by level, search with level filter, highlight terms,
 * follow mode and byte-offset bookmarks. Knows nothing about files: the app passes the lines and
 * implements copy/save of a bookmark range.
 */
export function LogView({
  lines,
  highlights,
  onHighlightsChange,
  follow,
  onFollowChange,
  bookmarks,
  onBookmarksChange,
  endOffset,
  onCopyFrom,
  onSaveFrom,
  rowHeight = 20,
}: LogViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [query, setQuery] = useState<LogQuery>({ text: '' });
  const [levels, setLevels] = useState<ReadonlySet<LogLevel>>(() => new Set());
  const [currentN, setCurrentN] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; line: LogLine; word: string } | null>(null);
  const marks = bookmarks !== undefined && onBookmarksChange !== undefined ? { list: bookmarks, change: onBookmarksChange } : null;
  const markList = marks?.list;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    setViewport(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const filtered = useMemo(() => filterLines(lines, levels.size ? levels : null), [lines, levels]);
  const counts = useMemo(() => levelCounts(lines), [lines]);
  const re = useMemo(() => matcher(query), [query]);
  const reError = useMemo(() => matcherError(query), [query]);
  const hits = useMemo(() => matchIndexes(filtered, re), [filtered, re]);
  const windowStart = lines[0]?.offset ?? endOffset ?? 0;
  const rows = useMemo(
    () => (markList ? withMarkers(filtered, markList, windowStart, endOffset) : filtered),
    [filtered, markList, windowStart, endOffset],
  );
  const longest = useMemo(() => filtered.reduce((max, l) => Math.max(max, l.text.length), 0), [filtered]);
  const currentHit = useMemo(
    () => (currentN === null ? -1 : hits.findIndex((i) => filtered[i]!.n === currentN)),
    [hits, filtered, currentN],
  );

  const gutterCh = String((lines.at(-1)?.n ?? 0) + 1).length + 2;
  const { start, end } = visibleRange(scrollTop, viewport, rowHeight, rows.length);
  // Rows hold at most 50 markers, so a line's row index is within 50 of its index in `filtered`.
  const rowOf = (index: number) => rows.indexOf(filtered[index]!, index);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [follow, rows]);

  const reveal = (row: number) => {
    const el = scroller.current;
    if (!el || row < 0) return;
    const top = row * rowHeight;
    if (top < el.scrollTop || top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 2);
  };

  const changeQuery = (next: LogQuery) => {
    setQuery(next);
    setCurrentN(null);
  };

  const goTo = (hit: number, list = hits) => {
    const index = list[hit];
    if (index === undefined) return;
    setCurrentN(filtered[index]!.n);
    reveal(rowOf(index));
  };

  const step = (dir: 1 | -1) => {
    if (!hits.length) return;
    if (currentHit >= 0) {
      goTo((currentHit + dir + hits.length) % hits.length);
      return;
    }
    // No current hit yet: start from the top of the view.
    const top = lineIndexAt(rows, Math.floor((scroller.current?.scrollTop ?? 0) / rowHeight));
    const below = hits.findIndex((i) => i >= top);
    const first = below >= 0 ? below : hits.length;
    goTo(dir > 0 ? first % hits.length : (first - 1 + hits.length) % hits.length);
  };

  const findSimilar = (line: LogLine, word: string) => {
    if (!word) return;
    const next: LogQuery = { ...query, text: word, wholeWord: true, regex: false };
    changeQuery(next);
    const list = matchIndexes(filtered, matcher(next));
    const after = list.findIndex((i) => filtered[i]!.n > line.n);
    goTo(after >= 0 ? after : 0, list);
  };

  const addTerm = (text: string) => onHighlightsChange(addHighlight(highlights, text));

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape' && query.text) {
      e.preventDefault();
      e.stopPropagation();
      changeQuery({ ...query, text: '' });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      searchInput.current?.focus();
      searchInput.current?.select();
    }
  };

  const onScroll = (el: HTMLDivElement) => {
    setScrollTop(el.scrollTop);
    if (follow && onFollowChange && el.scrollHeight - el.scrollTop - el.clientHeight > rowHeight) onFollowChange(false);
  };

  const toggleLevel = (level: LogLevel) => {
    const next = new Set(levels);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    setLevels(next);
  };

  const addMark = (bookmark: LogBookmark) => marks?.change(addBookmark(marks.list, bookmark));

  const bookmarkEnd = () => {
    if (endOffset === undefined) return;
    const last = lines.at(-1)?.partial ? lines.at(-2) : lines.at(-1);
    const at = Date.now();
    addMark({ offset: endOffset, label: clock(at), at, preview: last?.text.slice(0, MAX_PREVIEW_CHARS) ?? '' });
  };

  const bookmarkLine = (line: LogLine) =>
    addMark({ offset: line.offset, label: t('log.lineLabel', { n: line.n + 1 }), at: Date.now(), preview: line.text.slice(0, MAX_PREVIEW_CHARS) });

  const menuItems = (line: LogLine, word: string): Array<ContextMenuItem | 'sep'> => {
    const shown = word.length > MENU_WORD_CHARS ? `${word.slice(0, MENU_WORD_CHARS)}…` : word;
    const items: Array<ContextMenuItem | 'sep'> = [
      { id: 'highlight', label: t('log.highlightWord', { word: shown }), icon: 'highlight', disabled: !word || highlights.length >= MAX_HIGHLIGHTS, run: () => addTerm(word) },
      { id: 'search', label: t('log.searchWord', { word: shown }), icon: 'search', disabled: !word, run: () => findSimilar(line, word) },
      'sep',
      { id: 'copy', label: t('log.copyLine'), icon: 'copy', run: () => void copyText(line.text) },
    ];
    if (marks) items.push({ id: 'bookmark', label: t('log.bookmarkLine'), icon: 'bookmark', run: () => bookmarkLine(line) });
    return items;
  };

  const renderText = (line: LogLine, current: boolean) =>
    segments(line.text, highlights, re).map((s, k) =>
      s.hit ? (
        <mark key={k} className={`log-hit${current ? ' current' : ''}`}>{s.text}</mark>
      ) : s.term !== undefined ? (
        <span key={k} className={`log-term log-c-${highlights[s.term]!.color}`}>{s.text}</span>
      ) : (
        s.text
      ),
    );

  const currentLineN = currentHit >= 0 ? currentN : null;

  return (
    <div className="log-view" onKeyDown={onKeyDown}>
      <div className="log-toolbar">
        <div className="log-search">
          <Icon name="search" size={14} />
          <input
            ref={searchInput}
            value={query.text}
            placeholder={t('log.search')}
            aria-label={t('log.search')}
            aria-invalid={reError !== null}
            spellCheck={false}
            onChange={(e) => changeQuery({ ...query, text: e.target.value })}
            onKeyDown={onSearchKey}
          />
          <button className={`btn btn-ghost btn-sm log-toggle${query.caseSensitive ? ' active' : ''}`} aria-pressed={!!query.caseSensitive} title={t('log.caseSensitive')} onClick={() => changeQuery({ ...query, caseSensitive: !query.caseSensitive })}>Aa</button>
          <button className={`btn btn-ghost btn-sm log-toggle${query.wholeWord ? ' active' : ''}`} aria-pressed={!!query.wholeWord} title={t('log.wholeWord')} onClick={() => changeQuery({ ...query, wholeWord: !query.wholeWord })}>ab</button>
          <button className={`btn btn-ghost btn-sm log-toggle${query.regex ? ' active' : ''}`} aria-pressed={!!query.regex} title={t('log.regex')} onClick={() => changeQuery({ ...query, regex: !query.regex })}>.*</button>
        </div>
        {query.text && <span className="log-hits" role="status">{currentHit + 1}/{hits.length}</span>}
        <button className="btn btn-ghost btn-sm log-icon-btn btn-icon" title={t('log.prev')} aria-label={t('log.prev')} disabled={!hits.length} onClick={() => step(-1)}><Icon name="chevron-up" size={14} /></button>
        <button className="btn btn-ghost btn-sm log-icon-btn btn-icon" title={t('log.next')} aria-label={t('log.next')} disabled={!hits.length} onClick={() => step(1)}><Icon name="chevron-down" size={14} /></button>
        <div className="log-levels" role="group" aria-label={t('log.levels')}>
          {LOG_LEVELS.map((level) => (
            <button key={level} className={`chip log-level lvl-${level}${levels.has(level) ? ' chip-on' : ''}`} aria-pressed={levels.has(level)} onClick={() => toggleLevel(level)}>
              {t(`log.level.${level}`)} <span className="log-level-count">{counts[level]}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        {onFollowChange && (
          <button className={`btn btn-ghost btn-sm${follow ? ' active' : ''}`} aria-pressed={!!follow} title={t('log.followHint')} onClick={() => onFollowChange(!follow)}>
            <Icon name="follow" size={14} /> {t('log.follow')}
          </button>
        )}
        {marks && endOffset !== undefined && (
          <button className="btn btn-ghost btn-sm" title={t('log.bookmarkEndHint')} onClick={bookmarkEnd}>
            <Icon name="bookmark" size={14} /> {t('log.bookmarkEnd')}
          </button>
        )}
        {marks && (
          <LogBookmarkMenu
            bookmarks={marks.list}
            onBookmarksChange={marks.change}
            lines={lines}
            endOffset={endOffset}
            onGoTo={(b) => reveal(rows.indexOf(b))}
            onCopyFrom={onCopyFrom}
            onSaveFrom={onSaveFrom}
          />
        )}
      </div>
      {reError !== null && <div className="field-error log-regex-error">{reError}</div>}
      <LogHighlightBar highlights={highlights} onHighlightsChange={onHighlightsChange} />
      <div ref={scroller} className="log-scroll" tabIndex={0} onScroll={(e) => onScroll(e.currentTarget)}>
        {rows.length === 0 ? (
          <div className="log-empty">{lines.length ? t('log.emptyFiltered') : t('log.empty')}</div>
        ) : (
          <div className="log-body" style={{ height: rows.length * rowHeight, width: `calc(${longest + gutterCh}ch + 32px)` }}>
            {rows.slice(start, end).map((row, i) => {
              const index = start + i;
              const style = { height: rowHeight, lineHeight: `${rowHeight}px`, transform: `translateY(${index * rowHeight}px)` };
              if (!isLine(row)) {
                return (
                  <div key={`b${row.at}-${row.offset}`} className="log-marker" style={style}>
                    <span className="log-gutter" style={{ width: `${gutterCh}ch` }}><Icon name="bookmark" size={12} /></span>
                    <span className="log-marker-label">{row.label}</span>
                    <span className="log-bm-time">{clock(row.at)}</span>
                  </div>
                );
              }
              const current = row.n === currentLineN;
              const level = row.level ? ` lvl-${row.level}${row.own ? '' : ' cont'}` : '';
              return (
                <div
                  key={row.n}
                  className={`log-row${level}${row.partial ? ' partial' : ''}${current ? ' current' : ''}`}
                  style={style}
                  onDoubleClick={(e) => findSimilar(row, wordUnder(e, row.text))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ at: { x: e.clientX, y: e.clientY }, line: row, word: wordUnder(e, row.text) });
                  }}
                >
                  <span className="log-gutter" style={{ width: `${gutterCh}ch` }}>{row.n + 1}</span>
                  <span className="log-text">{renderText(row, current)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {menu && <ContextMenu at={menu.at} items={menuItems(menu.line, menu.word)} onClose={() => setMenu(null)} />}
    </div>
  );
}
