import { useEffect, useState } from 'react';
import { dayKey, keyMs } from './dates';

/** The app language, as set on the document by `setLanguage`. */
const locale = (): string | undefined => (typeof document !== 'undefined' && document.documentElement.lang) || undefined;

const utcFormat = (options: Intl.DateTimeFormatOptions, key: string): string =>
  new Intl.DateTimeFormat(locale(), { ...options, timeZone: 'UTC' }).format(new Date(keyMs(key)));

/** "October 2026". */
export const monthTitle = (key: string): string => utcFormat({ month: 'long', year: 'numeric' }, key);

/** Short weekday name (0 = Sunday). */
export const weekdayName = (weekday: number, width: 'short' | 'narrow' = 'short'): string => utcFormat({ weekday: width }, `2026-01-${String(4 + weekday).padStart(2, '0')}`);

/** "Wed, Oct 21". */
export const dayTitle = (key: string): string => utcFormat({ weekday: 'short', month: 'short', day: 'numeric' }, key);

/** "09:30" in the local zone. */
export const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

/** Today's key, refreshed every minute. */
export function useToday(): string {
  const [today, setToday] = useState(() => dayKey(new Date()));
  useEffect(() => {
    const timer = window.setInterval(() => setToday(dayKey(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}
