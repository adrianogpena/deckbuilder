import { useCallback, useEffect, useState } from 'react';
import { errorOf } from '@deckbuilderkit/ui';
import { t } from '../../../i18n';
import { formatCost, liveLimit, resetLabel, shownPercent } from '../../usage-format';
import { useAgentsHost } from '../../workspace/host';
import type { PanelModule, PanelProps } from '../../workspace/types';
import { loadUsage, saveBudgets, type Budgets, type Limits, type Row, type Totals, type UsageData } from './usage-api';
import './style.css';

const POLL_MS = 60_000;
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const keyOf = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const nameOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

function TotalsCard({ label, v }: { label: string; v: Totals }) {
  return (
    <div className="usage-card">
      <span className="mono-label">{label}</span>
      <strong>{formatCost(v.usd)}</strong>
      <span>{t('panel.usage.input')} {tok(v.input)} · {t('panel.usage.output')} {tok(v.output)}</span>
      <span>{t('panel.usage.cacheWrite')} {tok(v.cacheWrite)} · {t('panel.usage.cacheRead')} {tok(v.cacheRead)}</span>
    </div>
  );
}

function Table({ title, rows, label }: { title: string; rows: Row[]; label?: (key: string) => string }) {
  return (
    <section className="usage-section">
      <h3>{title}</h3>
      <table className="usage-table">
        <thead>
          <tr>
            <th />
            <th>{t('panel.usage.input')}</th>
            <th>{t('panel.usage.output')}</th>
            <th>{t('panel.usage.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td title={r.key}>{label ? label(r.key) : r.key}</td>
              <td>{tok(r.input + r.cacheWrite + r.cacheRead)}</td>
              <td>{tok(r.output)}</td>
              <td>{formatCost(r.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LimitInputs({ value, onChange }: { value: Limits; onChange(v: Limits): void }) {
  const field = (kind: 'daily' | 'monthly', label: string) => (
    <label>
      {label}{' '}
      <input
        type="number"
        min="0"
        step="0.5"
        value={value[kind] ?? ''}
        onChange={(e) => onChange({ ...value, [kind]: e.target.value === '' ? undefined : Number(e.target.value) })}
      />
    </label>
  );
  return (
    <>
      {field('daily', t('panel.usage.dailyLimit'))}
      {field('monthly', t('panel.usage.monthlyLimit'))}
    </>
  );
}

function UsagePanel({ visible }: PanelProps) {
  const host = useAgentsHost();
  const [data, setData] = useState<UsageData>();
  const [budgets, setBudgets] = useState<Budgets>({ global: {}, projects: {} });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await loadUsage());
      setError('');
    } catch (e) {
      setError(errorOf(e).message);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [visible, refresh]);

  const loaded = data !== undefined;
  useEffect(() => {
    if (data) setBudgets(data.budgets);
  }, [loaded]);

  const save = async () => {
    try {
      await saveBudgets(budgets);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      void refresh();
    } catch (e) {
      setError(errorOf(e).message);
    }
  };

  const now = Date.now();
  const s = data?.summary;
  const max = Math.max(0.01, ...(s?.days.map((d) => d.usd) ?? []));
  const budgetKeys = Object.keys(budgets.projects);
  const spentOf = (scope: string, kind: 'day' | 'month') => (scope ? data?.spend.projects[scope]?.[kind] : data?.spend[kind]) ?? 0;
  const budgetRow = (scope: string, name: string, v: Limits, onChange: (v: Limits) => void, onRemove?: () => void) => (
    <div className="usage-budget" key={scope || 'global'}>
      <span className="usage-name" title={scope}>{name}</span>
      <LimitInputs value={v} onChange={onChange} />
      <span>{formatCost(spentOf(scope, 'day'))} / {formatCost(spentOf(scope, 'month'))} {t('panel.usage.spent')}</span>
      {onRemove && <button type="button" onClick={onRemove}>{t('panel.usage.remove')}</button>}
    </div>
  );

  return (
    <div className="agents-panel-usage">
      <div className="usage-bar">
        <h2>{t('panel.usage.title')}</h2>
        {error && <span className="error">{error}</span>}
        <button type="button" onClick={() => void refresh()}>{t('panel.usage.refresh')}</button>
      </div>
      {!s ? (
        <div>{t('panel.usage.loading')}</div>
      ) : (
        <>
          <div className="usage-totals">
            <TotalsCard label={t('panel.usage.today')} v={s.today} />
            <TotalsCard label={t('panel.usage.week')} v={s.week} />
            <TotalsCard label={t('panel.usage.month')} v={s.month} />
          </div>
          <section className="usage-section">
            <h3>{t('panel.usage.daily')}</h3>
            <div className="usage-days">
              {s.days.map((d) => (
                <div key={d.day} title={`${d.day}: ${formatCost(d.usd)}`} style={{ height: `${(d.usd / max) * 100}%` }} />
              ))}
            </div>
            <div>{t('panel.usage.burn')}: {formatCost(s.burnPerHour)}{t('panel.usage.perHour')}</div>
          </section>
          <section className="usage-section">
            <h3>{t('panel.usage.limits')}</h3>
            <div className="usage-limits">
              {host.usage.filter((a) => a.fiveHour || a.sevenDay).length === 0 && <span>{t('panel.usage.noLimits')}</span>}
              {host.usage.map((a) => {
                const five = liveLimit(a.fiveHour, now);
                const seven = liveLimit(a.sevenDay, now);
                if (!five && !seven) return null;
                const use24h = host.usageSettings?.use24h ?? false;
                return (
                  <div key={a.account}>
                    <strong>{a.label}</strong>
                    {five && <> · {t('panel.usage.fiveHour')} {shownPercent(five.percent)}%{five.resetsAt ? ` (${resetLabel(five.resetsAt, 'fiveHour', use24h)})` : ''}</>}
                    {seven && <> · {t('panel.usage.sevenDay')} {shownPercent(seven.percent)}%{seven.resetsAt ? ` (${resetLabel(seven.resetsAt, 'sevenDay', use24h)})` : ''}</>}
                  </div>
                );
              })}
            </div>
          </section>
          {s.month.usd === 0 && <div>{t('panel.usage.empty')}</div>}
          <div className="usage-tables">
            <Table title={t('panel.usage.bySession')} rows={s.bySession} label={(k) => host.sessions.find((x) => x.id === k)?.title ?? k.slice(0, 8)} />
            <Table title={t('panel.usage.byProject')} rows={s.byProject} label={nameOf} />
            <Table title={t('panel.usage.byModel')} rows={s.byModel} />
          </div>
          <section className="usage-section">
            <h3>{t('panel.usage.budgets')}</h3>
            {budgetRow('', t('panel.usage.global'), budgets.global, (v) => setBudgets({ ...budgets, global: v }))}
            {budgetKeys.map((k) =>
              budgetRow(k, nameOf(host.projects.find((p) => keyOf(p.path) === k)?.path ?? k), budgets.projects[k]!, (v) => setBudgets({ ...budgets, projects: { ...budgets.projects, [k]: v } }), () => {
                const { [k]: _gone, ...rest } = budgets.projects;
                setBudgets({ ...budgets, projects: rest });
              }),
            )}
            <div className="usage-budget">
              <select
                value=""
                onChange={(e) => {
                  const k = keyOf(e.target.value);
                  if (k) setBudgets({ ...budgets, projects: { ...budgets.projects, [k]: budgets.projects[k] ?? {} } });
                }}
              >
                <option value="">{t('panel.usage.projectBudget')}: {t('panel.usage.pickProject')}</option>
                {host.projects.filter((p) => !(keyOf(p.path) in budgets.projects)).map((p) => (
                  <option key={p.id} value={p.path}>{nameOf(p.path)}</option>
                ))}
              </select>
              <button type="button" onClick={() => void save()}>{saved ? t('panel.usage.saved') : t('panel.usage.save')}</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export const panel: PanelModule = {
  kind: 'usage',
  titleKey: 'panel.usage.title',
  icon: 'database',
  placement: 'both',
  single: true,
  Panel: UsagePanel,
};
