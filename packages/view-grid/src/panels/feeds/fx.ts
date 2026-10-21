export interface FxData {
  base: string;
  quote: string;
  /** `YYYY-MM-DD` per value. */
  dates: string[];
  /** The quote per base unit, oldest first. */
  values: number[];
}

export interface FxSummary {
  value: number;
  /** Change vs. the first day, in the quote currency. */
  change: number;
  /** Change vs. the first day, in percent. */
  percent: number;
}

/** The `YYYY-MM-DD` of `days` days before `now`, in UTC. */
export const startDate = (now: Date, days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

export const currencyCode = (value: string, fallback: string): string => {
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
};

/** The rates of a Frankfurter time series (`{ rates: { date: { QUOTE: n } } }`), oldest first. */
export function mapSeries(raw: any, base: string, quote: string): FxData {
  const rates: Record<string, Record<string, unknown>> = raw?.rates && typeof raw.rates === 'object' ? raw.rates : {};
  const dates: string[] = [];
  const values: number[] = [];
  for (const date of Object.keys(rates).sort()) {
    const v = rates[date]?.[quote];
    if (typeof v === 'number' && Number.isFinite(v)) {
      dates.push(date);
      values.push(v);
    }
  }
  return { base, quote, dates, values };
}

/** Latest value and the change vs. the first day; undefined without data. */
export function summarize(values: readonly number[]): FxSummary | undefined {
  if (values.length === 0) return undefined;
  const value = values[values.length - 1]!;
  const firstValue = values[0]!;
  const change = value - firstValue;
  return { value, change, percent: firstValue ? (change / firstValue) * 100 : 0 };
}
