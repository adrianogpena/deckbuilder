import { type ReactNode, useEffect, useState } from 'react';
import { t } from '../i18n';
import type { AgentAccountUsage, AgentCategory, AgentRateLimit, AgentSession } from '../protocol.ts';
import type { AgentsSettings, AgentsUsagePosition } from '../settings-types';
import { Badge } from './Badge';
import { cacheState, clampPercent, costTrend, formatCost, isStale, liveLimit, modelLine, resetLabel, severity, shortDuration, shownPercent, startupShown, type UsageMetric } from './usage-format';
import './usage.css';

/** Rows of the full layout that can be hidden. */
export interface UsageItems {
  account: boolean;
  model: boolean;
  cache: boolean;
  context: boolean;
  fiveHour: boolean;
  sevenDay: boolean;
  cost: boolean;
}

/** `agents.usage.*` settings with defaults applied. */
export interface UsageSettings {
  show: boolean;
  position: AgentsUsagePosition;
  compact: boolean;
  use24h: boolean;
  items: UsageItems;
}

export function usageSettingsOf(s: AgentsSettings | undefined): UsageSettings {
  return {
    show: s?.['usage.show'] === true,
    position: s?.['usage.position'] === 'top' ? 'top' : 'bottom',
    compact: s?.['usage.compact'] === true,
    use24h: s?.['usage.use24HourClock'] === true,
    items: {
      account: s?.['usage.showAccount'] !== false,
      model: s?.['usage.showModel'] !== false,
      cache: s?.['usage.showCache'] !== false,
      context: s?.['usage.showContext'] !== false,
      fiveHour: s?.['usage.showFiveHour'] !== false,
      sevenDay: s?.['usage.showSevenDay'] !== false,
      cost: s?.['usage.showCost'] !== false,
    },
  };
}

/** The selected session's own fields the view reads. */
export type UsageSession = Pick<AgentSession, 'account' | 'contextPercent' | 'startupContextPercent' | 'modelName' | 'effort' | 'claudeVersion' | 'cache'>;

/** What the view shows: the selected session, its account's 5h / 7d, and the account label (only with several accounts). */
export interface UsageViewData {
  session?: UsageSession;
  usage?: AgentAccountUsage;
  accountLabel?: string;
  /** Every account with usage or cost data: one card group each (the picked `usage` first). */
  accounts?: AgentAccountUsage[];
  /** Number of sessions per state category. */
  counts?: Partial<Record<AgentCategory, number>>;
}

export interface UsageViewProps extends UsageViewData {
  items?: Partial<UsageItems>;
  compact?: boolean;
  use24h?: boolean;
  /** Fixed clock (previews, tests); otherwise ticks every 30 s for staleness, resets and the cache countdown. */
  now?: number;
  /** A click on the block (opens the Usage tab). */
  onOpen?(): void;
  className?: string;
}

/** Sample data for settings previews: a warm cache, two accounts with cost, a stale 7d reading. */
export function usageSample(now: number = Date.now()): UsageViewData {
  const data: UsageViewData = {
    accountLabel: 'me@example.com',
    counts: { running: 2, waiting: 1, idle: 3, error: 0, stopped: 4 },
    session: { account: '.claude', contextPercent: 42, startupContextPercent: 12, modelName: 'Opus 4.1', effort: 'high', claudeVersion: '2.1.0', cache: { lastRequestAt: now - 90_000, ttlMs: 300_000 } },
    usage: {
      account: '.claude',
      label: 'me@example.com',
      email: 'me@example.com',
      updatedAt: now - 60_000,
      fiveHour: { percent: 73, resetsAt: now + 2 * 3_600_000, updatedAt: now - 60_000 },
      sevenDay: { percent: 12, resetsAt: now + 3 * 86_400_000, updatedAt: now - 20 * 60_000 },
      cost: { today: 4.82, yesterday: 3.1 },
    },
  };
  return { ...data, accounts: [data.usage!, { account: '.claude-work', label: 'work', updatedAt: now - 5 * 60_000, fiveHour: { percent: 18, resetsAt: now + 4 * 3_600_000, updatedAt: now - 5 * 60_000 }, cost: { today: 1.25, yesterday: 2.4 } }] };
}

/** Picks the active account (the selected session's, else the freshest with data) and its label when there are several accounts. */
export function usageViewData(session: UsageSession | undefined, accounts: AgentAccountUsage[], accountIds: Iterable<string>, counts?: UsageViewData['counts']): UsageViewData {
  const usage = (session ? accounts.find((a) => a.account === session.account) : undefined)
    ?? accounts.find((a) => a.active)
    ?? [...accounts].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const ids = new Set(accountIds);
  for (const a of accounts) ids.add(a.account);
  const accountLabel = ids.size > 1 ? (usage?.email ?? usage?.label ?? session?.account) : undefined;
  return { session, usage, accountLabel, counts, accounts };
}

function useNow(fixed: number | undefined): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [fixed]);
  return fixed ?? now;
}

const LABEL: Record<UsageMetric, () => string> = {
  context: () => t('agents.usage.context'),
  fiveHour: () => t('agents.usage.fiveHour'),
  sevenDay: () => t('agents.usage.sevenDay'),
};

const None = () => <span className="agents-usage-none" title={t('agents.usage.noData')}>—</span>;

const LIMITS: Array<['fiveHour' | 'sevenDay', () => string]> = [
  ['fiveHour', () => t('agents.usageCard.fiveHour')],
  ['sevenDay', () => t('agents.usageCard.weekly')],
];

const ARROW = { up: '↑', down: '↓' } as const;

/** 11px label and percent on one line, a bar under it, then a note (reset time, startup context). */
function Metric({ label, metric, percent, stale, note, title }: { label: string; metric: UsageMetric; percent?: number; stale: boolean; note?: string; title?: string }) {
  const sev = percent === undefined ? '' : ` sev-${severity(metric, percent)}`;
  return (
    <span className={`agents-ucard-metric${sev}${stale ? ' stale' : ''}`} title={title}>
      <span className="agents-ucard-line">
        <span className="agents-ucard-label">{label}</span>
        <span className="agents-ucard-pct">{percent === undefined ? <None /> : `${shownPercent(percent)}%`}</span>
      </span>
      {percent !== undefined && (
        <span className="agents-ucard-bar" aria-hidden="true"><span style={{ width: `${clampPercent(percent)}%` }} /></span>
      )}
      {note && <span className="agents-ucard-note">{note}</span>}
    </span>
  );
}

/** One account: header, today's cost with the trend vs yesterday, 5-hour and weekly limits; the selected session's context, model and cache in its account's group. */
function AccountGroup({ acc, name, session, own, show, now, use24h }: { acc?: AgentAccountUsage; name?: string; session?: UsageSession; own: boolean; show: (k: keyof UsageItems) => boolean; now: number; use24h: boolean }) {
  const cost = acc?.cost;
  const trend = costTrend(cost?.today, cost?.yesterday);
  const staleOf = (l: AgentRateLimit) => isStale(l.updatedAt ?? acc?.updatedAt, now);
  const staleTitle = (l: AgentRateLimit) => (staleOf(l) ? t('agents.usage.stale', { age: shortDuration(now - (l.updatedAt ?? acc?.updatedAt ?? now)) }) : undefined);
  const context = session?.contextPercent;
  const startup = startupShown(context, session?.startupContextPercent);
  const model = modelLine(session?.modelName, session?.effort);
  const cache = session?.cache && cacheState(session.cache, now);
  return (
    <span className="agents-ucard-group">
      {session && show('context') && (
        <Metric label={LABEL.context()} metric="context" percent={context} stale={false} note={startup !== undefined ? t('agents.usage.startup', { n: startup }) : undefined} />
      )}
      {LIMITS.map(([k, label]) => {
        if (!show(k)) return null;
        const l = liveLimit(acc?.[k], now);
        const note = l?.resetsAt !== undefined ? t('agents.usageCard.resets', { time: resetLabel(l.resetsAt, k, use24h) }) : undefined;
        return <Metric key={k} label={label()} metric={k} percent={l?.percent} stale={!!l && staleOf(l)} title={l && staleTitle(l)} note={note} />;
      })}
      {acc && show('cost') && (
        <span className="agents-ucard-cost" title={t('agents.usageCard.costExplain')}>
          <span className="agents-ucard-label">{t('agents.usageCard.today')}</span>
          <span className="agents-ucard-amount">{formatCost(cost?.today)}</span>
          {trend && trend.dir !== 'flat' && (
            <span className={`agents-ucard-trend ${trend.dir}`}>
              <span aria-hidden="true">{ARROW[trend.dir]}</span>
              {trend.pct !== undefined ? ` ${t('agents.usageCard.vsYesterday', { pct: `${trend.pct}%` })}` : ''}
            </span>
          )}
        </span>
      )}
      {session && own && ((show('model') && model) || (show('cache') && cache)) && (
        <span className="agents-ucard-meta">
          {show('model') && model && (
            <span className="agents-ucard-model" title={session.claudeVersion ? `${model} · v${session.claudeVersion}` : model}>
              <Badge kind="neutral">{model}</Badge>
            </span>
          )}
          {show('cache') && cache && (
            <span className={`agents-ucard-cache ${cache.warm ? 'warm' : 'cold'}`}>
              {cache.warm ? `${t('agents.usage.cached')} · ${t('agents.usage.left', { n: cache.minutesLeft })}` : `${t('agents.usage.fetch')} · ${cache.since}`}
            </span>
          )}
        </span>
      )}
      {show('account') && name && <span className="agents-ucard-account" title={acc?.email ?? name}>Claude ({name})</span>}
    </span>
  );
}

/** Usage card (spec S10): per-account groups (today's cost, 5-hour and weekly limits; the selected session's context, model, cache) or one compact line. */
export function UsageView({ session, usage, accountLabel, items = {}, compact = false, use24h = false, now: fixedNow, onOpen, className }: UsageViewProps) {
  const now = useNow(fixedNow);
  const show = (k: keyof UsageItems) => items[k] !== false;
  const context = session?.contextPercent;
  const limits: Array<['fiveHour' | 'sevenDay', AgentRateLimit | undefined]> = [
    ['fiveHour', liveLimit(usage?.fiveHour, now)],
    ['sevenDay', liveLimit(usage?.sevenDay, now)],
  ];
  const staleOf = (l: AgentRateLimit) => isStale(l.updatedAt ?? usage?.updatedAt, now);
  const staleTitle = (l: AgentRateLimit) => (staleOf(l) ? t('agents.usage.stale', { age: shortDuration(now - (l.updatedAt ?? usage?.updatedAt ?? now)) }) : undefined);

  const parts: Array<{ key: string; text: string; cls: string; title?: string }> = [];
  if (show('context') && context !== undefined) parts.push({ key: 'context', text: `${t('agents.usage.ctx')} ${shownPercent(context)}%`, cls: `sev-${severity('context', context)}` });
  for (const [k, l] of limits) {
    if (show(k) && l) parts.push({ key: k, text: `${LABEL[k]()} ${shownPercent(l.percent)}%`, cls: `sev-${severity(k, l.percent)}${staleOf(l) ? ' stale' : ''}`, title: staleTitle(l) });
  }
  if (show('cost') && usage?.cost) parts.unshift({ key: 'cost', text: `${t('agents.usageCard.today')} ${formatCost(usage.cost.today)}`, cls: 'agents-usage-cost', title: t('agents.usageCard.costEstimate') });
  const summary = parts.map((p) => p.text).join(' · ') || t('agents.usage.noData');

  let body: ReactNode;
  if (compact) {
    body = (
      <span className="agents-usage-compact">
        {parts.length === 0 ? <None /> : parts.map((p, i) => (
          <span key={p.key}>
            {i > 0 && <span className="agents-usage-sep"> · </span>}
            <span className={p.cls} title={p.title}>{p.text}</span>
          </span>
        ))}
      </span>
    );
  } else {
    body = (
      <span className="agents-ucard">
        <AccountGroup acc={usage} name={usage?.label ?? accountLabel ?? session?.account} session={session} own={!usage || !session || session.account === usage.account} show={show} now={now} use24h={use24h} />
      </span>
    );
  }

  const cls = `agents-usage-view${compact ? ' compact' : ''}${className ? ` ${className}` : ''}`;
  if (!onOpen) return <section className={cls} aria-label={`${t('agents.usage')}: ${summary}`}>{body}</section>;
  return (
    <button type="button" className={`${cls} clickable`} title={t('agents.usage.open')} aria-label={`${t('agents.usage')}: ${summary}`} onClick={onOpen}>
      {body}
    </button>
  );
}
