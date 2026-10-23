export interface Meeting {
  names: string[];
  spoken: Record<string, boolean>;
  /** Local date `YYYY-MM-DD` of the last reset. */
  lastReset: string;
}

export const MAX_NAME = 60;
export const MAX_NAMES = 50;

export function localDate(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const emptyMeeting = (today: string = localDate()): Meeting => ({ names: [], spoken: {}, lastReset: today });

export function parseMeeting(raw: unknown): Meeting {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { names?: unknown; spoken?: unknown; lastReset?: unknown };
  const names: string[] = [];
  if (Array.isArray(r.names)) {
    for (const n of r.names) {
      if (typeof n !== 'string') continue;
      const name = n.trim().slice(0, MAX_NAME);
      if (name && !names.some((x) => x.toLowerCase() === name.toLowerCase()) && names.length < MAX_NAMES) names.push(name);
    }
  }
  const spoken: Record<string, boolean> = {};
  const s = (r.spoken && typeof r.spoken === 'object' ? r.spoken : {}) as Record<string, unknown>;
  for (const n of names) if (s[n] === true) spoken[n] = true;
  const lastReset = typeof r.lastReset === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.lastReset) ? r.lastReset : '';
  return { names, spoken, lastReset };
}

export const withDailyReset = (m: Meeting, today: string): Meeting => (m.lastReset === today ? m : { ...m, spoken: {}, lastReset: today });

export const reset = (m: Meeting, today: string): Meeting => ({ ...m, spoken: {}, lastReset: today });

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function toggle(m: Meeting, name: string): Meeting {
  if (!m.names.includes(name)) return m;
  const spoken = { ...m.spoken };
  if (spoken[name]) delete spoken[name];
  else spoken[name] = true;
  return { ...m, spoken };
}

export function add(m: Meeting, name: string): Meeting {
  const n = name.trim();
  if (!n || n.length > MAX_NAME || m.names.length >= MAX_NAMES || m.names.some((x) => same(x, n))) return m;
  return { ...m, names: [...m.names, n] };
}

export function rename(m: Meeting, from: string, to: string): Meeting {
  const n = to.trim();
  if (!m.names.includes(from) || !n || n.length > MAX_NAME || m.names.some((x) => x !== from && same(x, n))) return m;
  if (n === from) return m;
  const spoken = { ...m.spoken };
  if (spoken[from]) spoken[n] = true;
  delete spoken[from];
  return { ...m, names: m.names.map((x) => (x === from ? n : x)), spoken };
}

export function remove(m: Meeting, name: string): Meeting {
  const spoken = { ...m.spoken };
  delete spoken[name];
  return { ...m, names: m.names.filter((x) => x !== name), spoken };
}

export const sorted = (names: readonly string[]): string[] => [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
