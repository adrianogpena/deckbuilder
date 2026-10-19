import type { ReactNode } from 'react';

export type BadgeKind = 'working' | 'waiting' | 'danger' | 'neutral' | 'ok';

/** Mono uppercase badge (spec S4). `pulse` shows a breathing dot; on by default for `working`. Classes `agents-badge agents-badge--<kind>`. */
export function Badge({ kind, children, pulse }: { kind: BadgeKind; children: ReactNode; pulse?: boolean }) {
  const dot = pulse ?? kind === 'working';
  return (
    <span className={`agents-badge agents-badge--${kind}`}>
      {dot && <span className="agents-badge-dot" aria-hidden />}
      {children}
    </span>
  );
}
