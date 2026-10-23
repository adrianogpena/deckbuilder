import { useEffect, useState } from 'react';
import { Empty, Modal, request } from '@deckbuilderkit/ui';
import { t } from '../i18n';
import type { AgentAccountUsage, AgentRateLimit, AgentSession, AgentSevenDayHistory } from '../protocol.ts';
import { barCells, historyRows, isStale, liveLimit, resetLabel, severity, shortDuration, shownPercent, type SeverityThresholds } from './usage-format';

/** Cells of the Usage tab bars. */
export const TAB_BAR_CELLS = 24;

export const usageHistory = () => request<AgentSevenDayHistory>('GET', '/api/agents/usage/history');

export interface UsageTabProps {
  usage: AgentAccountUsage[];
  /** Account of the selected session (else the freshest reading's): marked '(active)'. */
  activeAccount?: string;
  use24h?: boolean;
  thresholds?: SeverityThresholds;
  /** Sessions whose context % is listed under their account. */
  sessions?: Array<Pick<AgentSession, 'id' | 'account' | 'cwd' | 'title' | 'name' | 'contextPercent'>>;
  onClose(): void;
}

function Limit({ metric, limit, fallbackAt, use24h, now, thresholds }: { metric: 'fiveHour' | 'sevenDay'; limit: AgentRateLimit | undefined; fallbackAt: number; use24h: boolean; now: number; thresholds?: SeverityThresholds }) {
  const label = t(metric === 'fiveHour' ? 'agents.usage.fiveHour' : 'agents.usage.sevenDay');
  if (!limit) {
    return (
      <div className="agents-usage-tab-row">
        <span className="mono-label">{label}</span>
        <span className="agents-usage-none" title={t('agents.usage.noData')}>—</span>
      </div>
    );
  }
  const at = limit.updatedAt ?? fallbackAt;
  const stale = isStale(at, now);
  const filled = barCells(limit.percent, TAB_BAR_CELLS);
  return (
    <div className={`agents-usage-tab-row sev-${severity(metric, limit.percent, thresholds)}${stale ? ' stale' : ''}`} title={stale ? t('agents.usage.stale', { age: shortDuration(now - at) }) : undefined}>
      <span className="mono-label">{label}</span>
      <span className="agents-usage-cells" aria-hidden="true">
        {Array.from({ length: TAB_BAR_CELLS }, (_, i) => <span key={i} className={i < filled ? 'on' : undefined} />)}
      </span>
      <span className="agents-usage-pct">{shownPercent(limit.percent)}%</span>
      {limit.resetsAt !== undefined && <span className="agents-usage-extra">{t('agents.usage.resets')} {resetLabel(limit.resetsAt, metric, use24h)}</span>}
    </div>
  );
}

/** Usage tab: per Claude account its 5h / 7d windows and the 7d spend of the last 5 days; Escape closes. */
export function UsageTab({ usage, activeAccount, use24h = false, thresholds, sessions, onClose }: UsageTabProps) {
  const [history, setHistory] = useState<AgentSevenDayHistory>({});
  const now = Date.now();
  useEffect(() => {
    let live = true;
    usageHistory()
      .then((h) => live && setHistory(h))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [usage]);

  const accounts = [...usage].sort((a, b) => Number(b.account === activeAccount) - Number(a.account === activeAccount));
  return (
    <Modal title={t('agents.usage')} onClose={onClose}>
      {accounts.length === 0 && <Empty title={t('agents.usage.empty')}>{t('agents.usage.emptyHint')}</Empty>}
      <div className="agents-usage-tab">
        {accounts.map((a) => (
          <section key={a.account} className="agents-usage-tab-account" aria-label={a.email ?? a.label}>
            <header className="agents-usage-tab-head">
              <span className="agents-usage-text" title={a.email ?? a.label}>{a.email ?? a.label}</span>
              {a.account === activeAccount && <span className="agents-usage-tab-active">{t('agents.usage.active')}</span>}
            </header>
            {(sessions ?? []).filter((s) => s.account === a.account && s.contextPercent !== undefined).map((s) => (
              <div key={s.id} className={`agents-usage-tab-row sev-${severity('context', s.contextPercent!, thresholds)}`}>
                <span className="mono-label">{t('agents.usage.context')}</span>
                <span className="agents-usage-text" title={s.cwd}>{s.name ?? s.title}</span>
                <span className="agents-usage-pct">{shownPercent(s.contextPercent!)}%</span>
              </div>
            ))}
            <Limit metric="fiveHour" limit={liveLimit(a.fiveHour, now)} fallbackAt={a.updatedAt} use24h={use24h} now={now} thresholds={thresholds} />
            <Limit metric="sevenDay" limit={liveLimit(a.sevenDay, now)} fallbackAt={a.updatedAt} use24h={use24h} now={now} thresholds={thresholds} />
            <div className="mono-label agents-usage-tab-caption">{t('agents.usage.daily')}</div>
            <div className="agents-usage-tab-days">
              {historyRows(history[a.email || 'unknown'], now).map((d) => (
                <div key={d.day} className="agents-usage-tab-day" title={d.day}>
                  <span className="mono-label">{d.weekday}</span>
                  {d.percent === undefined ? <span className="agents-usage-none" title={t('agents.usage.noData')}>—</span> : <span>{Math.round(d.percent)}%</span>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
