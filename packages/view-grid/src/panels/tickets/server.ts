import { invalid } from '@kedalion/server-core';
import { createJsonStore, type JsonStore } from '../../json-store';
import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { fetchPrPool, trackedStore } from '../github/server';
import type { TrackedPr } from '../github/tracked';
import { latestPods } from '../pods/server';
import { readWeekHours } from '../timesheet/server';
import { TICKETS_FIELDS } from './fields';
import { planAutoMoves } from './auto-move';
import { linkTickets } from './linker';
import { add, extractKey, MAX_TICKETS, move, parseStatuses, remove, update, type Ticket } from './model';
import type { TicketsData } from './types';

interface TicketsConfig {
  connection: string;
  statuses: string;
  keyPattern: string;
  jiraBaseUrl: string;
  autoMove?: boolean;
  readyLabel?: string;
  [key: string]: unknown;
}

interface TicketStore {
  tickets: Ticket[];
  /** Auto-move rules seen per ticket key at the last fetch. */
  autoMoveMemory: Record<string, string[]>;
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
      if (Array.isArray(o.podLinks)) t.podLinks = o.podLinks.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 500)).slice(0, 50);
      if (typeof o.movedAt === 'number') t.movedAt = o.movedAt;
      if (typeof o.autoMovedAt === 'number') t.autoMovedAt = o.autoMovedAt;
      tickets.push(t);
    }
  }
  const autoMoveMemory: Record<string, string[]> = {};
  const mem = (raw as { autoMoveMemory?: unknown })?.autoMoveMemory;
  if (mem && typeof mem === 'object') {
    for (const [k, v] of Object.entries(mem as Record<string, unknown>)) {
      if (Array.isArray(v)) autoMoveMemory[k.slice(0, 100)] = v.filter((x): x is string => typeof x === 'string').slice(0, 10);
    }
  }
  return { tickets, autoMoveMemory };
}

const stores = new Map<string, JsonStore<TicketStore>>();
/** The `tickets` store of a data dir. */
export function ticketsStore(dataDir: string): JsonStore<TicketStore> {
  let s = stores.get(dataDir);
  if (!s) {
    s = createJsonStore({ dataDir, name: 'tickets', parse: parseStore, empty: () => ({ tickets: [], autoMoveMemory: {} }) });
    stores.set(dataDir, s);
  }
  return s;
}

const payloadOf = (p: unknown) => (p ?? {}) as Record<string, unknown>;

export const ticketsSource = defineSource<TicketsConfig>({
  id: 'tickets',
  fields: TICKETS_FIELDS,
  async fetch(config, ctx): Promise<TicketsData> {
    const store = ticketsStore(ctx.dataDir);
    let { tickets } = await store.read();
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
    const pods = latestPods();
    const { links, unlinked } = linkTickets(
      tickets.map((t) => t.key),
      prs,
      pods,
      hours,
      config.keyPattern,
      Object.fromEntries(tickets.filter((t) => t.podLinks?.length).map((t) => [t.key, t.podLinks!])),
    );
    const statuses = parseStatuses(config.statuses ?? '');
    if (config.connection && !prError) {
      const now = Date.now();
      const saved = await store.update((s) => {
        const plan = planAutoMoves(s.tickets, links, statuses, s.autoMoveMemory, config.autoMove !== false, config.readyLabel || 'ready to merge');
        let list = s.tickets;
        for (const m of plan.moves) {
          list = move(list, m.id, m.status, Number.MAX_SAFE_INTEGER, now).map((t) => (t.id === m.id ? { ...t, autoMovedAt: now } : t));
        }
        return { tickets: list, autoMoveMemory: plan.memory };
      });
      tickets = saved.tickets;
    }
    return { statuses, tickets, links, unlinked, pods, ...(prError ? { prError } : {}) };
  },
  actions: {
    async add(payload, config, ctx) {
      const p = payloadOf(payload);
      const key = extractKey(str(p.key, 200), config.keyPattern);
      if (!key) throw invalid('ticket-invalid-key', 'Not a ticket key.');
      const status = parseStatuses(config.statuses ?? '')[0]!;
      const description = str(p.description);
      const saved = await ticketsStore(ctx.dataDir).update((s) => {
        if (s.tickets.some((t) => t.key === key)) throw invalid('ticket-duplicate', 'The ticket is already on the board.', { key });
        if (s.tickets.length >= MAX_TICKETS) throw invalid('ticket-limit', 'The board is full.');
        return { ...s, tickets: add(s.tickets, key, status, description) };
      });
      return saved.tickets;
    },
    async move(payload, _config, ctx) {
      const p = payloadOf(payload);
      const index = typeof p.index === 'number' && Number.isFinite(p.index) ? Math.trunc(p.index) : 0;
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: move(s.tickets, str(p.id, 100), str(p.status, 200), index) }))).tickets;
    },
    async update(payload, _config, ctx) {
      const p = payloadOf(payload);
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: update(s.tickets, str(p.id, 100), { description: str(p.description) }) }))).tickets;
    },
    async 'link-pod'(payload, _config, ctx) {
      const p = payloadOf(payload);
      const pod = str(p.pod, 500);
      if (!pod) throw invalid('ticket-invalid-pod', 'Not a pod.');
      const on = p.linked !== false;
      return (
        await ticketsStore(ctx.dataDir).update((s) => ({
          ...s,
          tickets: s.tickets.map((t) => {
            if (t.id !== str(p.id, 100)) return t;
            const rest = (t.podLinks ?? []).filter((x) => x !== pod);
            return { ...t, podLinks: on ? [...rest, pod] : rest };
          }),
        }))
      ).tickets;
    },
    async 'set-auto-move'(payload, _config, ctx) {
      const p = payloadOf(payload);
      const autoMove = typeof p.value === 'boolean' ? p.value : null;
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: update(s.tickets, str(p.id, 100), { autoMove }) }))).tickets;
    },
    async remove(payload, _config, ctx) {
      const p = payloadOf(payload);
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: remove(s.tickets, str(p.id, 100)) }))).tickets;
    },
  },
});

export const specs: GridPanelSpec[] = [{ kind: 'tickets', fields: TICKETS_FIELDS, allowMultiple: false }];

export const sources: DataSource<any>[] = [ticketsSource];
