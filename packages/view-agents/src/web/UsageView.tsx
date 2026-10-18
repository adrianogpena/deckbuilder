import { type ReactNode, useEffect, useState } from 'react';
import { t } from '../i18n';
import type { AgentAccountUsage, AgentRateLimit, AgentSession } from '../protocol.ts';
import type { AgentsSettings, AgentsUsagePosition } from '../settings-types';
import { BAR_CELLS, barCells, cacheState, isStale, liveLimit, modelLine, resetLabel, severity, shortDuration, shownPercent, startupShown, type UsageMetric } from './usage-format';

/** Rows of the full layout that can be hidden. */
export interface UsageItems {
  account: boolean;
  model: boolean;
  cache: boolean;
  context: boolean;
  fiveHour: boolean;
  sevenDay: boolean;
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
    position: s?.['usage.position'] ?? 'float',
    compact: s?.['usage.compact'] === true,
    use24h: s?.['usage.use24HourClock'] === true,
    items: {
      account: s?.['usage.showAccount'] !== false,
      model: s?.['usage.showModel'] !== false,
      cache: s?.['usage.showCache'] !== false,
      context: s?.['usage.showContext'] !== false,
      fiveHour: s?.['usage.showFiveHour'] !== false,
      sevenDay: s?.['usage.showSevenDay'] !== false,
    },
  };
}

/** The selected session's own fields the view reads. */
export type UsageSession = Pick<AgentSession, 'account' | 'contextPercent' | 'startupContextPercent' | 'modelName' | 'effort' | 'cache'>;

/** What the view shows: the selected session, its account's 5h / 7d, and the account label (only with several accounts). */
export interface UsageViewData {
  session?: UsageSession;
  usage?: AgentAccountUsage;
  accountLabel?: string;
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

/** Sample data for settings previews: a warm cache, two accounts, a stale 7d reading. */
export function usageSample(now: number = Date.now()): UsageViewData {
  return {
    accountLabel: 'me@example.com',
    session: { account: '.claude', contextPercent: 42, startupContextPercent: 12, modelName: 'Opus 4.1', effort: 'high', cache: { lastRequestAt: now - 90_000, ttlMs: 300_000 } },
    usage: {
      account: '.claude',
      label: 'me@example.com',
      email: 'me@example.com',
      updatedAt: now - 60_000,
      fiveHour: { percent: 73, resetsAt: now + 2 * 3_600_000, updatedAt: now - 60_000 },
      sevenDay: { percent: 12, resetsAt: now + 3 * 86_400_000, updatedAt: now - 20 * 60_000 },
    },
  };
}

/** Picks the active account (the selected session's, else the freshest with data) and its label when there are several accounts. */
export function usageViewData(session: UsageSession | undefined, accounts: AgentAccountUsage[], accountIds: Iterable<string>): UsageViewData {
  const flagged = accounts.some((a) => a.active !== undefined);
  const usage = flagged
    ? accounts.find((a) => a.active)
    : session ? accounts.find((a) => a.account === session.account) : [...accounts].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const ids = new Set(accountIds);
  for (const a of accounts) ids.add(a.account);
  const accountLabel = ids.size > 1 ? (usage?.email ?? usage?.label ?? session?.account) : undefined;
  return { session, usage, accountLabel };
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

function Row({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <span className="agents-usage-row" title={title}>
      <span className="mono-label agents-usage-label">{label}</span>
      <span className="agents-usage-value">{children}</span>
    </span>
  );
}

function Meter({ metric, percent, stale, extra }: { metric: UsageMetric; percent: number; stale: boolean; extra?: string }) {
  const filled = barCells(percent);
  return (
    <span className={`agents-usage-meter sev-${severity(metric, percent)}${stale ? ' stale' : ''}`}>
      <span className="agents-usage-cells" aria-hidden="true">
        {Array.from({ length: BAR_CELLS }, (_, i) => <span key={i} className={i < filled ? 'on' : undefined} />)}
      </span>
      <span className="agents-usage-pct">{shownPercent(percent)}%</span>
      {extra && <span className="agents-usage-extra">{extra}</span>}
    </span>
  );
}

/** Usage of the selected Claude session: full layout (account, model, cache, context, 5h, 7d) or one compact line. */
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
    const model = modelLine(session?.modelName, session?.effort);
    const cache = session?.cache && cacheState(session.cache, now);
    const startup = startupShown(context, session?.startupContextPercent);
    body = (
      <span className="agents-usage-rows">
        {show('account') && accountLabel !== undefined && (
          <Row label={t('agents.usage.account')}><span className="agents-usage-text" title={accountLabel}>{accountLabel}</span></Row>
        )}
        {show('model') && (
          <Row label={t('agents.usage.model')}>{model ? <span className="agents-usage-text" title={model}>{model}</span> : <None />}</Row>
        )}
        {show('cache') && (
          <Row label={t('agents.usage.cache')}>
            {!cache ? <None /> : (
              <span className={`agents-usage-split ${cache.warm ? 'warm' : 'cold'}`}>
                <span>{cache.warm ? t('agents.usage.cached') : t('agents.usage.fetch')} ·</span>
                <span className="agents-usage-extra">{cache.warm ? t('agents.usage.left', { n: cache.minutesLeft }) : cache.since}</span>
              </span>
            )}
          </Row>
        )}
        {show('context') && (
          <Row label={LABEL.context()}>
            {context === undefined ? <None /> : <Meter metric="context" percent={context} stale={false} extra={startup !== undefined ? t('agents.usage.startup', { n: startup }) : undefined} />}
          </Row>
        )}
        {limits.map(([k, l]) => show(k) && (
          <Row key={k} label={LABEL[k]()} title={l && staleTitle(l)}>
            {!l ? <None /> : <Meter metric={k} percent={l.percent} stale={staleOf(l)} extra={l.resetsAt !== undefined ? resetLabel(l.resetsAt, k, use24h) : undefined} />}
          </Row>
        ))}
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
