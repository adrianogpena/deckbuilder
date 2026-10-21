import { useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { IconButton } from './Button';
import { Icon, type IconName, type Tone } from './ui';

/** Class of the panel header, the drag handle for `PanelGrid`. */
export const PANEL_HANDLE = 'panel-handle';
/** Elements inside the handle that must not start a drag. */
export const PANEL_NO_DRAG = 'panel-no-drag';

export interface PanelFrameProps {
  title: string;
  icon?: ReactNode;
  /** Extra header buttons, left of the built-in ones. */
  actions?: ReactNode;
  /** Controlled collapse state (`PanelGrid` owns and persists it); local state when omitted. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Shows a "…" button in the header that opens these items. */
  menu?: ContextMenuItem[];
  /** Shows the remove button. */
  onRemove?: () => void;
  children: ReactNode;
}

export function PanelFrame({ title, icon, actions, collapsed: controlled, onCollapsedChange, menu, onRemove, children }: PanelFrameProps) {
  const [local, setLocal] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const collapsed = controlled ?? local;
  const toggle = () => {
    setLocal(!collapsed);
    onCollapsedChange?.(!collapsed);
  };
  const label = t(collapsed ? 'panel.expand' : 'panel.collapse');

  return (
    <section className={`panel${collapsed ? ' collapsed' : ''}`} aria-label={title}>
      <header className={`panel-head ${PANEL_HANDLE}`}>
        {icon && <span className="panel-icon">{icon}</span>}
        <h2 className="panel-title">{title}</h2>
        <div className={`panel-tools ${PANEL_NO_DRAG}`}>
          {actions}
          {menu && menu.length > 0 && (
            <IconButton
              icon="more"
              label={t('panel.menu')}
              data-panel-menu
              aria-haspopup="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMenuAt({ x: r.left, y: r.bottom + 4 });
              }}
            />
          )}
          <IconButton icon="chevron-down" label={label} className={`panel-collapse${collapsed ? ' collapsed' : ''}`} onClick={toggle} aria-expanded={!collapsed} />
          {onRemove && <IconButton icon="close" label={t('panel.remove')} className="panel-remove" onClick={onRemove} />}
        </div>
      </header>
      {menuAt && menu && <ContextMenu at={menuAt} items={menu} onClose={() => setMenuAt(null)} />}
      {!collapsed && <div className="panel-body">{children}</div>}
    </section>
  );
}

export function PanelLoading() {
  return (
    <div className="panel-loading" aria-busy="true" aria-label={t('common.loading')}>
      <span className="skeleton" style={{ width: '75%' }} />
      <span className="skeleton" style={{ width: '50%' }} />
      <span className="skeleton" style={{ width: '65%' }} />
    </div>
  );
}

/** Centered icon, title, message and optional action: the shape of every non-data panel state. */
export function PanelNotice({ icon, title, message, action, tone = 'muted' }: {
  icon: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="panel-notice" role="status">
      <span className={`panel-notice-icon tone-${tone}`}>{icon}</span>
      <p className="panel-notice-title">{title}</p>
      {message && <p className="panel-notice-message">{message}</p>}
      {action && <div className="panel-notice-action">{action}</div>}
    </div>
  );
}

/** Thin bar above last-known data (offline, failed refresh); `icon` defaults to wifi-off (warn) / alert (err). */
export function PanelBanner({ tone, children, action, icon }: { tone: 'warn' | 'err'; children: ReactNode; action?: ReactNode; icon?: IconName }) {
  return (
    <div className={`panel-banner tone-${tone}`} role="status">
      <Icon name={icon ?? (tone === 'warn' ? 'wifi-off' : 'alert')} size={14} />
      <span className="panel-banner-text">{children}</span>
      {action}
    </div>
  );
}
