import type { ReactNode } from 'react';
import './kit.css';

export interface ListRow {
  id: string;
  title: string;
  href?: string;
  /** Leading chip, e.g. a `Chip`. */
  chip?: ReactNode;
  /** Small parts after the title, joined by a separator. */
  meta?: readonly string[];
  trailing?: string;
}

/** Compact rows that scroll inside the panel; `empty` shows when there are none. */
export function ListRows({ rows, empty }: { rows: readonly ListRow[]; empty: string }) {
  if (rows.length === 0) return <p className="kit-empty">{empty}</p>;
  return (
    <ul className="kit-rows">
      {rows.map((r) => (
        <li key={r.id} className="kit-row">
          {r.chip}
          <span className="kit-row-main">
            {r.href ? (
              <a className="kit-row-title" href={r.href} target="_blank" rel="noreferrer" title={r.title}>{r.title}</a>
            ) : (
              <span className="kit-row-title" title={r.title}>{r.title}</span>
            )}
            {r.meta && r.meta.length > 0 && <span className="kit-row-meta">{r.meta.join(' · ')}</span>}
          </span>
          {r.trailing && <span className="kit-row-trailing">{r.trailing}</span>}
        </li>
      ))}
    </ul>
  );
}
