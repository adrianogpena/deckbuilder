import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { PATHS, type IconName } from '../icons';
import { Icon, Modal } from './ui';

const COLUMNS = 6;
const NAMES = Object.keys(PATHS).sort() as IconName[];

/** Modal to pick one of the built-in icons by name. Arrow keys move, Enter picks. */
export function IconPicker({ value, onPick, onClose }: { value?: IconName; onPick: (icon: IconName) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? NAMES.filter((n) => n.includes(q)) : NAMES;
  }, [query]);

  const buttons = () => Array.from(grid.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[e.key];
    if (step === undefined || at < 0) return;
    e.preventDefault();
    all[Math.min(all.length - 1, Math.max(0, at + step))]?.focus();
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && shown[0]) {
      e.preventDefault();
      onPick(shown[0]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons()[0]?.focus();
    }
  };

  return (
    <Modal title={t('iconPicker.title')} onClose={onClose}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onSearchKey}
        placeholder={t('iconPicker.search')}
        aria-label={t('iconPicker.search')}
        autoFocus
      />
      {shown.length === 0 && <p className="muted">{t('iconPicker.empty')}</p>}
      <div ref={grid} className="icon-picker" onKeyDown={onGridKey}>
        {shown.map((name) => (
          <button
            key={name}
            className={`icon-picker-item${name === value ? ' active' : ''}`}
            onClick={() => onPick(name)}
            title={name}
            aria-pressed={name === value}
          >
            <Icon name={name} size={20} />
            <span>{name}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
