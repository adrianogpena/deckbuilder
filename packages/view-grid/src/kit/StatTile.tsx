import type { ReactNode } from 'react';
import type { Tone } from './Chip';
import './kit.css';

/** A big value with a label and an optional delta. */
export function StatTile({ value, label, delta, tone = 'neutral' }: { value: ReactNode; label: string; delta?: string; tone?: Tone }) {
  return (
    <div className="kit-stat">
      <span className={`kit-stat-value kit-text-${tone}`}>{value}</span>
      <span className="kit-stat-label">{label}</span>
      {delta && <span className={`kit-stat-delta kit-text-${tone}`}>{delta}</span>}
    </div>
  );
}
