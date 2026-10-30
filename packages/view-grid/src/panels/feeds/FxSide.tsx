import { useEffect, useState } from 'react';
import type { SidePanelContent } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { currencyCode } from './fx';
import { onFxHistory, readFxHistory } from './fx-history';
import type { FxConfig } from './ExchangeRate';
import './feeds.css';

const locale = (): string | undefined => (typeof document !== 'undefined' && document.documentElement.lang) || undefined;
const fmt = (n: number, digits = 4) => n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

function useHistory(base: string, quote: string) {
  const [history, setHistory] = useState(() => readFxHistory(base, quote));
  useEffect(() => {
    setHistory(readFxHistory(base, quote));
    return onFxHistory(base, quote, () => setHistory(readFxHistory(base, quote)));
  }, [base, quote]);
  return history;
}

function Row({ label, value, change, percent }: { label: string; value: number; change: number; percent: number }) {
  const sign = change > 0 ? '+' : '';
  const tone = change > 0 ? 'ok' : change < 0 ? 'danger' : 'neutral';
  return (
    <li className="fx-history-row">
      <span className="fx-history-date">{label}</span>
      <span className="fx-history-value">{fmt(value)}</span>
      <span className={`fx-history-change fx-${tone}`}>{`${sign}${fmt(change)} (${sign}${fmt(percent, 2)}%)`}</span>
    </li>
  );
}

/** One line per fetch, newest first: the value and change the panel showed after it. */
function UpdatesList({ base, quote }: { base: string; quote: string }) {
  const { updates } = useHistory(base, quote);
  if (updates.length === 0) return <p className="kit-empty">{tKey('dash.feeds.fx.empty')}</p>;
  const when = (at: string) => new Date(at).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'medium' });
  return (
    <ul className="fx-history">
      {[...updates].reverse().map((u) => (
        <Row key={u.at} label={when(u.at)} value={u.value} change={u.change} percent={u.percent} />
      ))}
    </ul>
  );
}

/** The points of the panel's graph, newest first, each with its change vs. the first day. */
function GraphList({ base, quote }: { base: string; quote: string }) {
  const { dates, values } = useHistory(base, quote);
  if (values.length === 0) return <p className="kit-empty">{tKey('dash.feeds.fx.empty')}</p>;
  const first = values[0]!;
  return (
    <ul className="fx-history">
      {dates
        .map((date, i) => ({ date, value: values[i]!, change: values[i]! - first, percent: first ? ((values[i]! - first) / first) * 100 : 0 }))
        .reverse()
        .map((p) => (
          <Row key={p.date} label={p.date} value={p.value} change={p.change} percent={p.percent} />
        ))}
    </ul>
  );
}

/** What the Exchange rate panel opens in the Dashboard side panel: every fetch, and the numbers of the graph. */
export function fxSideContent(config: FxConfig): SidePanelContent {
  const base = currencyCode(config.base, 'EUR');
  const quote = currencyCode(config.quote, 'BRL');
  return {
    id: `exchange-rate:${base}/${quote}`,
    title: `${base}/${quote}`,
    subtitle: tKey('dash.feeds.fx.history.subtitle', { days: config.days }),
    icon: 'history',
    tabs: [
      { id: 'updates', label: tKey('dash.feeds.fx.history.updates'), render: () => <UpdatesList base={base} quote={quote} /> },
      { id: 'graph', label: tKey('dash.feeds.fx.history.graph'), render: () => <GraphList base={base} quote={quote} /> },
    ],
  };
}
