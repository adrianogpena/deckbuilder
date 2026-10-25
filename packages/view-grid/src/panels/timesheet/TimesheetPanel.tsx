import { useState } from 'react';
import { Button, Icon, IconButton, type PanelConfig } from '@kedalion/ui';
import { tKey } from '../../i18n';
import { runAction } from '../../source';
import { NO_TICKET, parseDay, type DayTable } from './analysis';
import type { TimesheetResult } from './server';
import './timesheet.css';

export type TimesheetPanelData = TimesheetResult;

export interface TimesheetTable {
  tickets: string[];
  /** Hours per ticket and day (same order as `days`). */
  rows: { ticket: string; hours: number[]; commits: number; total: number }[];
  totals: number[];
  grand: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Rows and totals of the week, tickets sorted by total hours; "(no ticket)" last. */
export function tableOf(days: string[], table: DayTable): TimesheetTable {
  const names = new Set<string>();
  for (const day of days) for (const t of Object.keys(table[day] ?? {})) names.add(t);
  const rows = [...names].map((ticket) => {
    const hours = days.map((d) => table[d]?.[ticket]?.hours ?? 0);
    const commits = days.reduce((n, d) => n + (table[d]?.[ticket]?.commits ?? 0), 0);
    return { ticket, hours, commits, total: r2(hours.reduce((a, b) => a + b, 0)) };
  });
  rows.sort((a, b) => (a.ticket === NO_TICKET ? 1 : 0) - (b.ticket === NO_TICKET ? 1 : 0) || b.total - a.total || a.ticket.localeCompare(b.ticket));
  const totals = days.map((_, i) => r2(rows.reduce((n, r) => n + (r.hours[i] ?? 0), 0)));
  return { tickets: rows.map((r) => r.ticket), rows, totals, grand: r2(totals.reduce((a, b) => a + b, 0)) };
}

const fmt = (n: number): string => (n === 0 ? '' : n.toFixed(2));

export function TimesheetPanel({ config, data, refresh }: { config: PanelConfig; data: TimesheetPanelData | undefined; refresh(): void }) {
  const [busy, setBusy] = useState(false);
  const run = async (name: string, payload?: unknown) => {
    setBusy(true);
    try {
      await runAction('timesheet', name, config, payload);
    } catch {}
    setBusy(false);
    refresh();
  };
  const days = Object.keys(data?.days ?? {}).sort();
  const table = tableOf(days, data?.days ?? {});
  const locked = new Set(data?.lockedDays ?? []);
  const dayLabel = (d: string) => parseDay(d).toLocaleDateString(undefined, { weekday: 'short' });

  return (
    <div className="ts">
      <div className="ts-head">
        <Button size="sm" icon="refresh" disabled={busy} title={tKey('dash.timesheet.refresh')} onClick={() => void run('refresh')}>
          {tKey('dash.timesheet.refresh')}
        </Button>
      </div>
      {table.rows.length === 0 ? (
        <div className="ts-empty">{tKey('dash.timesheet.empty')}</div>
      ) : (
        <div className="ts-scroll">
          <table className="ts-table">
            <thead>
              <tr>
                <th>{tKey('dash.timesheet.ticket')}</th>
                {days.map((d) => {
                  const past = !!data && d < data.today;
                  const name = dayLabel(d);
                  return (
                    <th key={d} className="ts-num">
                      <span>{name}</span>
                      <IconButton
                        icon="lock"
                        size="xs"
                        pressed={locked.has(d)}
                        disabled={!past || busy}
                        label={tKey(locked.has(d) ? 'dash.timesheet.unlock' : 'dash.timesheet.lock', { day: name })}
                        onClick={() => void run('toggle-lock', { date: d })}
                      />
                    </th>
                  );
                })}
                <th className="ts-num">{tKey('dash.timesheet.total')}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.ticket}>
                  <td className="ts-ticket">
                    {r.ticket === NO_TICKET ? tKey('dash.timesheet.noTicket') : r.ticket}
                    {r.commits > 0 && (
                      <span className="ts-commits" title={tKey('dash.timesheet.commits', { count: r.commits })}>
                        <Icon name="git-branch" size={12} /> {r.commits}
                      </span>
                    )}
                  </td>
                  {r.hours.map((h, i) => (
                    <td key={days[i]} className="ts-num">{fmt(h)}</td>
                  ))}
                  <td className="ts-num ts-strong">{r.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{tKey('dash.timesheet.total')}</td>
                {table.totals.map((h, i) => (
                  <td key={days[i]} className="ts-num">{h.toFixed(2)}</td>
                ))}
                <td className="ts-num ts-strong">{table.grand.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
