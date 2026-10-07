import { useState, type ReactNode } from 'react';
import { errorMessage, type ApiError } from '../api';
import { copyText } from '../hooks';
import { t } from '../i18n';

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'muted';

export function Badge({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? 'spinner spinner-sm' : 'spinner'} aria-label={t('common.loading')} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

/** Page header: small mono caption above a large title, with actions on the right. */
export function PageHead({ crumb, title, children }: { crumb: string; title: string; children?: ReactNode }) {
  return (
    <div className="content-head">
      <div className="head-title">
        <span className="crumb">{crumb}</span>
        <h1>{title}</h1>
      </div>
      <span className="spacer" />
      {children}
    </div>
  );
}

export function ErrorBanner({ error, onRetry, compact }: { error: ApiError; onRetry?: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`error-banner${compact ? ' compact' : ''}`} role="alert">
      <div className="error-main">
        <Icon name="alert" />
        <div className="error-text">
          <strong>{errorMessage(error)}</strong>
        </div>
        <div className="error-actions">
          {error.detail && (
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>
              {open ? t('common.hideDetails') : t('common.details')}
            </button>
          )}
          {onRetry && (
            <button className="btn btn-sm" onClick={onRetry}>
              <Icon name="refresh" /> {t('common.retry')}
            </button>
          )}
        </div>
      </div>
      {open && <pre className="error-detail">{error.detail}</pre>}
    </div>
  );
}

export function CopyButton({ text, label = t('common.copy') }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }
      }}
      title={label}
    >
      <Icon name={done ? 'check' : 'copy'} />
      {label && <span>{done ? t('common.copied') : label}</span>}
    </button>
  );
}

/** Modal dialog; Escape or a click on the backdrop closes it. */
export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('common.close')}><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// 24x24 stroke icons (Feather/Lucide style). Add paths here as needed.
const PATHS: Record<string, string> = {
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M20 6 9 17l-5-5',
  close: 'M18 6 6 18M6 6l12 12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.3-4.3',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  home: 'M3 11 12 3l9 8v10h-6v-6H9v6H3z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  cube: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
};

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#9b8cff" />
      <rect x="6" y="5" width="12" height="3" rx="1.2" fill="#120d2b" opacity=".45" />
      <rect x="5" y="9" width="14" height="3" rx="1.2" fill="#120d2b" opacity=".7" />
      <rect x="4" y="13" width="16" height="6" rx="1.6" fill="#120d2b" />
      <circle cx="7.2" cy="16" r="1" fill="#9b8cff" />
    </svg>
  );
}

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.cube} />
    </svg>
  );
}
