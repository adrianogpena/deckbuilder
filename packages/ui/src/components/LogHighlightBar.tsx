import { useState, type FormEvent } from 'react';
import { t } from '../i18n';
import { addHighlight, type HighlightTerm, MAX_HIGHLIGHT_CHARS, MAX_HIGHLIGHTS, nextColor } from '../log';
import { Icon } from './ui';

interface LogHighlightBarProps {
  highlights: HighlightTerm[];
  onHighlightsChange(terms: HighlightTerm[]): void;
}

/** The highlight chips of a `LogView` (color cycle, remove) and the form that adds a word. */
export function LogHighlightBar({ highlights, onHighlightsChange }: LogHighlightBarProps) {
  const [term, setTerm] = useState('');
  const full = highlights.length >= MAX_HIGHLIGHTS;

  return (
    <div className="log-toolbar log-highlights">
      {highlights.map((h, i) => (
        <span key={h.text} className={`log-chip log-c-${h.color}`}>
          <button className="log-dot" title={t('log.highlightColor')} aria-label={t('log.highlightColor')} onClick={() => onHighlightsChange(highlights.map((x, j) => (j === i ? { ...x, color: nextColor(x.color) } : x)))} />
          <span className="log-chip-text">{h.text}</span>
          <button className="log-chip-x" title={t('log.highlightRemove')} aria-label={t('log.highlightRemove')} onClick={() => onHighlightsChange(highlights.filter((_, j) => j !== i))}>
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      <form
        className="log-add"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onHighlightsChange(addHighlight(highlights, term));
          setTerm('');
        }}
      >
        <input value={term} placeholder={t('log.highlightPlaceholder')} aria-label={t('log.highlightPlaceholder')} spellCheck={false} maxLength={MAX_HIGHLIGHT_CHARS} disabled={full} onChange={(e) => setTerm(e.target.value)} />
        <button title={t('log.highlightAdd')} type="submit" className="btn btn-ghost btn-sm" disabled={!term.trim() || full}>
          <Icon name="plus" size={14} /> {t('log.highlightAdd')}
        </button>
      </form>
    </div>
  );
}
