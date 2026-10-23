import { invalid } from '@deckbuilderkit/server-core';
import { createJsonStore, type JsonStore } from '../../json-store';
import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { fetchPrPool, trackedStore } from '../github/server';
import type { TrackedPr } from '../github/tracked';
import { latestPods } from '../pods/server';
import { readWeekHours } from '../timesheet/server';
import { TICKETS_FIELDS } from './fields';
import { linkTickets } from './linker';
import { add, extractKey, MAX_TICKETS, move, parseStatuses, remove, update, type Ticket } from './model';
import type { TicketsData } from './types';

interface TicketsConfig {
  connection: string;
  statuses: string;
  keyPattern: string;
  jiraBaseUrl: string;
  [key: string]: unknown;
}

interface TicketStore {
  tickets: Ticket[];
}

const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');

function parseStore(raw: unknown): TicketStore {
  const list = (raw as { tickets?: unknown })?.tickets;
  const tickets: Ticket[] = [];
  if (Array.isArray(list)) {
    for (const r of list.slice(0, MAX_TICKETS)) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const key = str(o.key, 100);
      if (!str(o.id, 100) || !key) continue;
      const t: Ticket = {
        id: str(o.id, 100),
        key,
        description: str(o.description),
        status: str(o.status, 200),
        autoMove: typeof o.autoMove === 'boolean' ? o.autoMove : null,
        order: typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : tickets.length,
      };
      if (typeof o.movedAt === 'number') t.movedAt = o.movedAt;
      if (typeof o.autoMovedAt === 'number') t.autoMovedAt = o.autoMovedAt;
      tickets.push(t);
    }
  }
  return { tickets };
}

const stores = new Map<string, JsonStore<TicketStore>>();
/** The `tickets` store of a data dir. */
export function ticketsStore(dataDir: string): JsonStore<TicketStore> {
  let s = stores.get(dataDir);
  if (!s) {
    s = createJsonStore({ dataDir, name: 'tickets', parse: parseStore, empty: () => ({ tickets: [] }) });
    stores.set(dataDir, s);
  }
  return s;
}

const payloadOf = (p: unknown) => (p ?? {}) as Record<string, unknown>;

export const ticketsSource = defineSource<TicketsConfig>({
  id: 'tickets',
  fields: TICKETS_FIELDS,
  async fetch(config, ctx): Promise<TicketsData> {
    const { tickets } = await ticketsStore(ctx.dataDir).read();
    let prs: TrackedPr[] = [];
    let prError = false;
    if (config.connection) {
      try {
        const conn = await ctx.connection(config.connection, 'github');
        const { refs } = await trackedStore(ctx.dataDir).read();
        prs = await fetchPrPool(conn, { tracked: refs, signal: ctx.signal });
      } catch {
        prError = true;
      }
    }
    const hours = await readWeekHours(ctx.dataDir).catch(() => ({}) as Record<string, number>);
    const { links, unlinked } = linkTickets(
      tickets.map((t) => t.key),
      prs,
      latestPods(),
      hours,
      config.keyPattern,
    );
    return { statuses: parseStatuses(config.statuses ?? ''), tickets, links, unlinked, ...(prError ? { prError } : {}) };
  },
  actions: {
    async add(payload, config, ctx) {
      const p = payloadOf(payload);
      const key = extractKey(str(p.key, 200), config.keyPattern);
      if (!key) throw invalid('ticket-invalid-key', 'Not a ticket key.');
      const status = parseStatuses(config.statuses ?? '')[0]!;
      const description = str(p.description);
      await ticketsStore(ctx.dataDir).update((s) => {
        if (s.tickets.some((t) => t.key === key)) throw invalid('ticket-duplicate', 'The ticket is already on the board.', { key });
        if (s.tickets.length >= MAX_TICKETS) throw invalid('ticket-limit', 'The board is full.');
        return { tickets: add(s.tickets, key, status, description) };
      });
      return null;
    },
    async move(payload, _config, ctx) {
      const p = payloadOf(payload);
      const index = typeof p.index === 'number' && Number.isFinite(p.index) ? Math.trunc(p.index) : 0;
      await ticketsStore(ctx.dataDir).update((s) => ({ tickets: move(s.tickets, str(p.id, 100), str(p.status, 200), index) }));
      return null;
    },
    async update(payload, _config, ctx) {
      const p = payloadOf(payload);
      await ticketsStore(ctx.dataDir).update((s) => ({ tickets: update(s.tickets, str(p.id, 100), { description: str(p.description) }) }));
      return null;
    },
    async remove(payload, _config, ctx) {
      const p = payloadOf(payload);
      await ticketsStore(ctx.dataDir).update((s) => ({ tickets: remove(s.tickets, str(p.id, 100)) }));
      return null;
    },
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'tickets', fields: TICKETS_FIELDS, allowMultiple: false }];

export const sources: DataSource<any>[] = [ticketsSource];
