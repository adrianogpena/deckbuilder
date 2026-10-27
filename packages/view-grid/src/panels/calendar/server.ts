import { invalid } from '@kedalion/server-core';
import { declaredTooLarge, readLimited, sourceFetch } from '../../connections/errors';
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
  const res = await sourceFetch(parsed.href, { headers: { accept: 'text/calendar, text/plain, */*' } }, { signal });
  if (declaredTooLarge(res, MAX_BYTES)) {
    await res.body?.cancel().catch(() => {});
    throw invalid('calendar.tooLarge', 'The calendar file is too large');
  }
  const { text, truncated } = await readLimited(res, MAX_BYTES);
  if (truncated) throw invalid('calendar.tooLarge', 'The calendar file is too large');
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
  cache.set(url, { at: now, text });
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
