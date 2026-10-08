import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { CopyButton, Icon, type Tone } from './ui';

export interface OutputLine {
  text: string;
  tone?: Tone;
  /** Epoch ms, shown as local HH:MM:SS. */
  at?: number;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false });
const lineText = (l: OutputLine) => (l.at === undefined ? l.text : `${time(l.at)} ${l.text}`);

/**
 * Log-style output: monospace lines, the last `maxLines` (after the filter) rendered.
 * Follows new lines until the user scrolls up, then offers "Jump to latest".
 */
export function OutputPanel({ lines, onClear, maxLines = 5000 }: { lines: OutputLine[]; onClear?: () => void; maxLines?: number }) {
  const [filter, setFilter] = useState('');
  const [following, setFollowing] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const needle = filter.toLowerCase();
    const matching = needle ? lines.filter((l) => l.text.toLowerCase().includes(needle)) : lines;
    return matching.length > maxLines ? matching.slice(-maxLines) : matching;
  }, [lines, filter, maxLines]);

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useLayoutEffect(() => {
    if (following) toBottom();
  }, [shown, following]);

  return (
    <div className="output">
      <div className="output-bar">
        <input
          className="output-filter"
          type="search"
          value={filter}
          placeholder={t('output.filter')}
          aria-label={t('output.filter')}
          onChange={(e) => setFilter(e.target.value)}
        />
        <CopyButton text={shown.map(lineText).join('\n')} label={t('output.copyAll')} />
        {onClear && <button className="btn btn-ghost btn-sm" onClick={onClear}>{t('output.clear')}</button>}
      </div>
      <div
        ref={scroller}
        className="output-lines"
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 4);
        }}
      >
        {shown.map((l, i) => (
          <div key={i} className={l.tone ? `output-line tone-${l.tone}` : 'output-line'}>
            {l.at !== undefined && <span className="output-time">{time(l.at)}</span>}
            {l.text}
          </div>
        ))}
      </div>
      {!following && (
        <button className="btn btn-sm output-jump" onClick={() => { setFollowing(true); toBottom(); }}>
          <Icon name="chevron-down" />
          <span>{t('output.jumpToLatest')}</span>
        </button>
      )}
    </div>
  );
}
