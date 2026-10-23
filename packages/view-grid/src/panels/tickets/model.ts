import { DEFAULT_TICKET_PATTERN } from '../github/map';

export interface Ticket {
  id: string;
  key: string;
  description: string;
  status: string;
  autoMove: boolean | null;
  order: number;
  movedAt?: number;
  autoMovedAt?: number;
}

export const MAX_TICKETS = 300;
export const DEFAULT_STATUSES = ['Open', 'In Progress', 'In Review', 'In Test', 'Ready to Merge', 'Done'];

/** One status per line; blank and duplicate lines dropped; the defaults when nothing is left. */
export function parseStatuses(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.length ? out : [...DEFAULT_STATUSES];
}

/** The upper-cased ticket key at the start of `input`, or null. An invalid pattern falls back to the default. */
export function extractKey(input: string, pattern: string = DEFAULT_TICKET_PATTERN): string | null {
  const text = input.trim();
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${pattern || DEFAULT_TICKET_PATTERN})`, 'i');
  } catch {
    re = new RegExp(`^(?:${DEFAULT_TICKET_PATTERN})`, 'i');
  }
  const m = re.exec(text);
  return m ? m[0].toUpperCase() : null;
}

const sorted = (tickets: Ticket[]) => [...tickets].sort((a, b) => a.order - b.order);

const renumber = (tickets: Ticket[]): Ticket[] => tickets.map((t, i) => (t.order === i ? t : { ...t, order: i }));

export function add(tickets: Ticket[], key: string, status: string, description = '', id: string = crypto.randomUUID()): Ticket[] {
  const order = tickets.reduce((n, t) => Math.max(n, t.order + 1), 0);
  return [...tickets, { id, key, description, status, autoMove: null, order }];
}

/** Moves a ticket to `status` at position `index` among that column's other tickets. */
export function move(tickets: Ticket[], id: string, status: string, index: number, now = Date.now()): Ticket[] {
  const all = sorted(tickets);
  const t = all.find((x) => x.id === id);
  if (!t) return tickets;
  const rest = all.filter((x) => x.id !== id);
  const moved: Ticket = { ...t, status, ...(t.status !== status ? { movedAt: now } : {}) };
  const inColumn = rest.filter((x) => x.status === status);
  const at = Math.max(0, Math.min(index, inColumn.length));
  const before = inColumn[at];
  const pos = before ? rest.indexOf(before) : inColumn.length ? rest.indexOf(inColumn[inColumn.length - 1]!) + 1 : rest.length;
  rest.splice(pos, 0, moved);
  return renumber(rest);
}

export function update(tickets: Ticket[], id: string, patch: Partial<Pick<Ticket, 'description' | 'autoMove'>>): Ticket[] {
  return tickets.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

export function remove(tickets: Ticket[], id: string): Ticket[] {
  return renumber(sorted(tickets.filter((t) => t.id !== id)));
}

/** Tickets per status, in order; a ticket with an unknown status goes to the first column. */
export function columns(tickets: Ticket[], statuses: string[]): { status: string; tickets: Ticket[] }[] {
  const cols = statuses.map((status) => ({ status, tickets: [] as Ticket[] }));
  if (!cols.length) return cols;
  for (const t of sorted(tickets)) (cols.find((c) => c.status === t.status) ?? cols[0]!).tickets.push(t);
  return cols;
}
