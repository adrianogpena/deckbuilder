import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorMessage, type ApiError } from '../api';
import { copyText } from '../hooks';
import { t } from '../i18n';
import { type IconName, PATHS } from '../icons';

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
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1200);
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

export type { IconName } from '../icons';

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

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
