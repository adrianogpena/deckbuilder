import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { filterPalette, type PaletteItem } from '../palette';

const PAGE = 8;

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => filterPalette(items, query), [items, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('.pal-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const last = results.length - 1;
  const choose = (item?: PaletteItem) => {
    if (!item) return;
    onClose();
    item.run();
  };
  const move = (e: React.KeyboardEvent, to: (i: number) => number) => {
    e.preventDefault();
    setIndex((i) => Math.max(0, Math.min(last, to(i))));
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true">
        <div className="pal-input">
          <span className="pal-key">:</span>
          <input
            ref={input}
            value={query}
            placeholder={t('palette.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') move(e, (i) => i + 1);
              else if (e.key === 'ArrowUp') move(e, (i) => i - 1);
              else if (e.key === 'PageDown') move(e, (i) => i + PAGE);
              else if (e.key === 'PageUp') move(e, (i) => i - PAGE);
              else if (e.key === 'Home') move(e, () => 0);
              else if (e.key === 'End') move(e, () => last);
              else if (e.key === 'Enter') choose(results[index]);
            }}
          />
        </div>
        <div className="pal-list" ref={list}>
          {results.length === 0 && <div className="pal-empty">{t('palette.empty')}</div>}
          {results.map((item, i) => (
            <button
              key={item.id}
              className={`pal-item${i === index ? ' active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(item)}
            >
              <span className="pal-group">{item.group}</span>
              <span className="pal-label">{item.label}</span>
              {item.hint && <span className="pal-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
        <div className="pal-foot">
          <span><kbd>↑↓</kbd>{t('palette.navigate')}</span>
          <span><kbd>enter</kbd>{t('palette.open')}</span>
          <span><kbd>esc</kbd>{t('palette.close')}</span>
        </div>
      </div>
    </div>
  );
}

/** Open state for the palette; Ctrl+K and Ctrl+Shift+P toggle it, also while typing in an input. */
export function useCommandPalette(): { open: boolean; setOpen: (open: boolean) => void } {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if ((key === 'k' && !e.shiftKey) || (key === 'p' && e.shiftKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}
