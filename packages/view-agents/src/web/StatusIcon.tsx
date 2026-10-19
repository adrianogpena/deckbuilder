import type { CSSProperties } from 'react';
import { ACCOUNT_STATUS_ICONS, type AccountStatusKey, type AgentStatus } from '../protocol.ts';
import { accountStatusKey, defaultStatusIcon, statusIconFor } from './account-prefs';
import { useAccountPrefs } from './useAccountPrefs';
import { StatusDot } from './StatusDot';
import './ui.css';
import './status-icon.css';

const DOT_OF: Record<AccountStatusKey, 'working' | 'attention' | 'idle' | 'stopped'> = { running: 'working', waiting: 'attention', idle: 'idle', stopped: 'stopped' };
const STATUS_OF: Record<AccountStatusKey, 'running' | 'needs-you' | 'idle' | 'stopped'> = { running: 'running', waiting: 'needs-you', idle: 'idle', stopped: 'stopped' };

/**
 * One curated status icon in the 8px dot slot (`--agents-dot-size`). The status default (first id of `ACCOUNT_STATUS_ICONS[status]`)
 * renders as the regular `StatusDot`, so it looks and animates exactly like the built-in one; other ids are static shapes in the status colour.
 * Wrapped in `.view-agents` so it also works outside the Agents screen (Settings).
 */
export function StatusIcon({ status, icon, title, size }: { status: AccountStatusKey; icon?: string; title?: string; size?: number }) {
  const id = icon && ACCOUNT_STATUS_ICONS[status].includes(icon) ? icon : defaultStatusIcon(status);
  return (
    <span className="view-agents agents-icon-host">
      {id === defaultStatusIcon(status) ? (
        <StatusDot status={STATUS_OF[status]} title={title} size={size} />
      ) : (
        <span
          className={`agents-dot agents-icon agents-icon--${id} agents-icon-c--${DOT_OF[status]}`}
          title={title}
          role={title ? 'img' : undefined}
          aria-label={title}
          aria-hidden={title ? undefined : true}
          style={size ? ({ '--agents-dot-size': `${size}px` } as CSSProperties) : undefined}
        />
      )}
    </span>
  );
}

/** A session's status dot with its account's chosen icon; statuses without an account icon (starting, done, error) keep the built-in dot. */
export function SessionDot({ status, account, title, size }: { status: AgentStatus; account?: string; title?: string; size?: number }) {
  const { prefs } = useAccountPrefs();
  const key = accountStatusKey(status);
  return key ? <StatusIcon status={key} icon={statusIconFor(prefs, account, key)} title={title} size={size} /> : <StatusDot status={status} title={title} size={size} />;
}
