import type { KeyboardEvent, ReactNode } from 'react';
import './kit.css';

export interface ListRow {
  id: string;
  title: string;
  href?: string;
  /** Leading chip, e.g. a `Chip`. */
  chip?: ReactNode;
  /** Small parts after the title, joined by a separator. */
  meta?: readonly string[];
  /** Status chips between the title block and `trailing`. */
  status?: ReactNode;
  trailing?: string;
  selected?: boolean;
  onClick?(): void;
}

/** Compact rows that scroll inside the panel; `empty` shows when there are none. */
export function ListRows({ rows, empty }: { rows: readonly ListRow[]; empty: string }) {
  if (rows.length === 0) return <p className="kit-empty">{empty}</p>;
  return (
    <ul className="kit-rows">
      {rows.map((r) => (
        <li
          key={r.id}
          className={`kit-row${r.onClick ? ' kit-row--click' : ''}${r.selected ? ' kit-row--selected' : ''}`}
          {...(r.onClick
            ? {
                tabIndex: 0,
                role: 'button',
                'aria-pressed': !!r.selected,
                onClick: r.onClick,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    r.onClick?.();
                  }
                },
              }
            : {})}
        >
          {r.chip}
          <span className="kit-row-main">
            {r.href && /^https?:/i.test(r.href) ? (
              <a className="kit-row-title" href={r.href} target="_blank" rel="noreferrer" title={r.title}>{r.title}</a>
            ) : (
              <span className="kit-row-title" title={r.title}>{r.title}</span>
            )}
            {r.meta && r.meta.length > 0 && <span className="kit-row-meta">{r.meta.join(' · ')}</span>}
          </span>
          {r.status}
          {r.trailing &&<span className="kit-row-trailing">{r.trailing}</span>}
        </li>
      ))}
    </ul>
  );
}
