import { useEffect, useState } from 'react';
import { Modal } from '@kedalion/ui';
import { t } from '../i18n';
import { type AgentAlert, type AgentProject, listAlerts } from './api';
import { statusLabel } from './Sidebar';

/** Short "time since": now, 5m, 3h, 2d. */
export function since(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return t('agents.alerts.now');
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Log of every status change noticed, newest first. Esc closes (Modal). */
export function AlertsPanel({ projects, onClose }: { projects: AgentProject[]; onClose(): void }) {
  const [items, setItems] = useState<AgentAlert[]>();

  useEffect(() => {
    let alive = true;
    const load = () => void listAlerts().then((l) => alive && setItems(l), () => alive && setItems((c) => c ?? []));
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Modal title={t('agents.alerts.title')} onClose={onClose}>
      <div className="agents-alerts">
        {items && items.length === 0 && <p className="agents-empty">{t('agents.alerts.empty')}</p>}
        <ul className="agents-alerts-list">
          {(items ?? []).map((a) => {
            const project = projects.find((p) => p.id === a.project)?.name ?? a.project;
            const verb = statusLabel(a.status);
            return (
              <li key={`${a.id}.${a.timestamp}`} className="agents-alert">
                <span className={`agents-dot ${a.status}`} role="img" title={verb} aria-label={verb} />
                <span className="agents-alert-text">
                  {verb}: {a.label}
                  {project ? ` · ${project}` : ''}
                </span>
                <time className="agents-alert-time" dateTime={new Date(a.timestamp).toISOString()} title={new Date(a.timestamp).toLocaleString()}>
                  {since(a.timestamp)}
                </time>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
