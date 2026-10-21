import { tKey } from '../../i18n';
import { Chip, fmtDuration, ListRows } from '../../kit';
import type { HealthResult } from './health';
import './misc.css';

const statusText = (r: HealthResult): string => (r.status > 0 ? String(r.status) : tKey(r.error === 'timeout' ? 'dash.misc.health.timeout' : 'dash.misc.health.down'));

export function UrlHealth({ results, layout }: { results: readonly HealthResult[]; layout: string }) {
  if (layout === 'dots' && results.length > 0) {
    return (
      <div className="misc-dots">
        {results.map((r, i) => (
          <a
            key={`${i}-${r.url}`}
            className={`misc-dot${r.ok ? '' : ' is-down'}`}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            title={`${statusText(r)}${r.status > 0 ? ` - ${fmtDuration(r.latencyMs)}` : ''}`}
          >
            <span className="misc-dot-led" />
            <span className="misc-dot-label">{r.label}</span>
          </a>
        ))}
      </div>
    );
  }
  return (
    <ListRows
      empty={tKey('dash.misc.health.empty')}
      rows={results.map((r, i) => ({
        id: `${i}-${r.url}`,
        title: r.label,
        href: r.url,
        chip: <Chip tone={r.ok ? 'ok' : 'danger'}>{statusText(r)}</Chip>,
        trailing: r.status > 0 ? fmtDuration(r.latencyMs) : undefined,
      }))}
    />
  );
}
