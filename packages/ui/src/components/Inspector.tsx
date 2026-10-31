import type { ReactNode } from 'react';
import { IconButton } from './Button';

export interface InspectorProps {
  title: string;
  /** Small text under the title (e.g. a type or id). */
  subtitle?: string;
  /** Shows a close button in the head. */
  onClose?: () => void;
  /** Action buttons pinned under the body. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** Right-hand detail slot of the content area: a head, label/value rows and an action row. Views reuse it for the selected item. */
export function Inspector({ title, subtitle, onClose, actions, children }: InspectorProps) {
  return (
    <aside className="inspector" aria-label={title}>
      <header className="inspector-head">
        <div className="inspector-titles">
          <div className="inspector-title">{title}</div>
          {subtitle && <div className="inspector-subtitle">{subtitle}</div>}
        </div>
        {onClose && <IconButton icon="close" size="xs" label="Close inspector" onClick={onClose} />}
      </header>
      <div className="inspector-body">{children}</div>
      {actions && <footer className="inspector-actions">{actions}</footer>}
    </aside>
  );
}

export function InspectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inspector-row">
      <span className="inspector-label">{label}</span>
      <span className="inspector-value">{children}</span>
    </div>
  );
}
