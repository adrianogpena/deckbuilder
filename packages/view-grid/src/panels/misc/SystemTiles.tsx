import { tKey } from '../../i18n';
import { hasColumn, StatTile } from '../../kit';
import type { Tone } from '../../kit';
import type { SystemStats } from './system';
import './misc.css';

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(bytes >= 100 * 1024 ** 3 ? 0 : 1)} GB`;
const pct = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 100) : 0);
const load = (p: number): Tone => (p >= 90 ? 'danger' : p >= 75 ? 'warn' : 'ok');

function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function System({ data, config }: { data: SystemStats; config: Record<string, unknown> }) {
  const memPct = pct(data.memory.usedBytes, data.memory.totalBytes);
  const diskUsed = data.disk ? pct(data.disk.totalBytes - data.disk.freeBytes, data.disk.totalBytes) : 0;
  return (
    <div className="misc-system">
      {hasColumn(config, 'show', 'cpu') && <StatTile value={`${data.cpu}%`} label={tKey('dash.misc.system.show.cpu')} tone={load(data.cpu)} />}
      {hasColumn(config, 'show', 'memory') && <StatTile value={`${memPct}%`} label={tKey('dash.misc.system.show.memory')} tone={load(memPct)} delta={`${gb(data.memory.usedBytes)} / ${gb(data.memory.totalBytes)}`} />}
      {hasColumn(config, 'show', 'disk') && data.disk && <StatTile value={gb(data.disk.freeBytes)} label={tKey('dash.misc.system.show.disk')} tone={load(diskUsed)} delta={tKey('dash.misc.system.diskTotal', { total: gb(data.disk.totalBytes) })} />}
      {hasColumn(config, 'show', 'uptime') && <StatTile value={uptime(data.uptimeSec)} label={tKey('dash.misc.system.show.uptime')} />}
    </div>
  );
}
