import type { ReactNode } from 'react';
import './kit.css';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

/** A small colored label. */
export function Chip({ tone = 'neutral', title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return <span className={`kit-chip kit-tone-${tone}`} title={title}>{children}</span>;
}
