import { tKey } from '../../i18n';
import { Chip, fmtDuration, ListRows } from '../../kit';
import type { HealthResult } from './health';
import './misc.css';

export function UrlHealth({ results }: { results: readonly HealthResult[] }) {
  return (
    <ListRows
      empty={tKey('dash.misc.health.empty')}
      rows={results.map((r, i) => ({
        id: `${i}-${r.url}`,
        title: r.label,
        href: r.url,
        chip: <Chip tone={r.ok ? 'ok' : 'danger'}>{r.status > 0 ? r.status : tKey(r.error === 'timeout' ? 'dash.misc.health.timeout' : 'dash.misc.health.down')}</Chip>,
        trailing: r.status > 0 ? fmtDuration(r.latencyMs) : undefined,
      }))}
    />
  );
}
