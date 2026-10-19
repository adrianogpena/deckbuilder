import type { CSSProperties } from 'react';
import type { AgentStatus } from '../protocol';

/** Visual kind of a status dot (spec S3). */
export type DotKind = 'attention' | 'working' | 'ok' | 'idle' | 'stopped' | 'error' | 'none';

/** Maps a session status (or 'none' for an empty spacer) to its dot kind. */
export function dotKind(status: AgentStatus | 'none'): DotKind {
  switch (status) {
    case 'needs-you': return 'attention';
    case 'running':
    case 'starting': return 'working';
    case 'done': return 'ok';
    case 'idle': return 'idle';
    case 'stopped': return 'stopped';
    case 'error':
    case 'exited': return 'error';
    default: return 'none';
  }
}

/** One status dot for rows, headers, strip and summaries. Classes `agents-dot agents-dot--<kind>` (CSS in `ui.css`). */
export function StatusDot({ status, title, size }: { status: AgentStatus | 'none'; title?: string; size?: number }) {
  const kind = dotKind(status);
  return (
    <span
      className={`agents-dot agents-dot--${kind}`}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={size ? ({ '--agents-dot-size': `${size}px` } as CSSProperties) : undefined}
    />
  );
}
