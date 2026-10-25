import { invalid } from '@kedalion/server-core';
import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { addDays, dayKey } from './dates';
import { fields, ICS_SOURCE_FIELDS } from './fields';
import { expandIcs } from './ics';

const CACHE_MS = 5 * 60_000;
const MAX_BYTES = 5_000_000;

const cache = new Map<string, { at: number; text: string }>();

async function icsText(rawUrl: string, signal: AbortSignal): Promise<string> {
  const url = rawUrl.trim().replace(/^webcals?:/i, 'https:');
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid('calendar.badUrl', 'The calendar URL is not valid');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw invalid('calendar.badUrl', 'The calendar URL is not valid');
  const res = await fetch(parsed, { signal, headers: { accept: 'text/calendar, text/plain, */*' } });
  if (!res.ok) throw invalid('calendar.fetchFailed', `The calendar returned HTTP ${res.status}`, { status: res.status });
  const text = await res.text();
  if (text.length > MAX_BYTES) throw invalid('calendar.tooLarge', 'The calendar file is too large');
  cache.set(url, { at: Date.now(), text });
  return text;
}

export const calendarIcsSource = defineSource<{ icsUrl: string; from: string; days: number }>({
  id: 'calendar-ics',
  fields: ICS_SOURCE_FIELDS,
  async fetch({ icsUrl, from, days }, { signal }) {
    if (!icsUrl.trim()) return [];
    const first = from || dayKey(new Date());
    return expandIcs(await icsText(icsUrl, signal), first, addDays(first, days - 1));
  },
});

export const specs: GridPanelSpec[] = [
  { kind: 'calendar', fields: fields.calendar, allowMultiple: true },
  { kind: 'sprint', fields: fields.sprint, allowMultiple: true },
  { kind: 'countdowns', fields: fields.countdowns, allowMultiple: true },
  { kind: 'agenda', fields: fields.agenda, allowMultiple: true },
];
export const sources: DataSource<any>[] = [calendarIcsSource];
