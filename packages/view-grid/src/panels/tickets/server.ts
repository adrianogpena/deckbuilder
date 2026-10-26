import { invalid } from '@kedalion/server-core';
import { createJsonStore, type JsonStore } from '../../json-store';
import { defineSource, type DataSource, type GridPanelSpec } from '../../server';
import { fieldIds, search } from '../jira/client';
import { fetchPrPool, trackedStore } from '../github/server';
import type { TrackedPr } from '../github/tracked';
import { latestPods } from '../pods/server';
import { TICKETS_FIELDS } from './fields';
import { planAutoMoves } from './auto-move';
import { infoFields, mapInfo, pcrOf, type JiraInfo } from './jira-info';
import { linkTickets } from './linker';
import { add, extractKey, MAX_TICKETS, move, normPodId, parsePcr, parseStatuses, remove, update, type Ticket } from './model';
import type { TicketsData } from './types';

interface TicketsConfig {
  connection: string;
  jiraConnection?: string;
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
      if (Array.isArray(o.aliases)) t.aliases = o.aliases.filter((x): x is string => typeof x === 'string' && !!x).map((x) => x.slice(0, 100)).slice(0, 50);
      if (parsePcr(str(o.pcr, 20))) t.pcr = parsePcr(str(o.pcr, 20));
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

/** A deterministic string of an auto-move memory (keys sorted), to compare two of them. */
const memorySig = (m: Record<string, string[]>): string => JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));

const payloadOf = (p: unknown) => (p ?? {}) as Record<string, unknown>;

export const ticketsSource = defineSource<TicketsConfig>({
  id: 'tickets',
  fields: TICKETS_FIELDS,
  async fetch(config, ctx): Promise<TicketsData> {
    const store = ticketsStore(ctx.dataDir);
    const stored = await store.read();
    let { tickets } = stored;
    let prError = false;
    const loadPrs = async (): Promise<TrackedPr[]> => {
      if (!config.connection) return [];
      try {
        const conn = await ctx.connection(config.connection, 'github');
        const { refs } = await trackedStore(ctx.dataDir).read();
        return await fetchPrPool(conn, { tracked: refs, keys: tickets.flatMap((t) => [t.key, ...(t.aliases ?? [])]), signal: ctx.signal });
      } catch {
        prError = true;
        return [];
      }
    };
    const loadJira = async (): Promise<Record<string, JiraInfo>> => {
      const jira: Record<string, JiraInfo> = {};
      if (config.jiraConnection && tickets.length) {
        try {
          const conn = await ctx.connection(config.jiraConnection, 'jira');
          const keys = tickets.map((t) => t.key).filter((k) => /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(k));
          const pointsId = (await fieldIds(conn, ctx.signal)).points;
          const raw = keys.length ? await search(conn, `key in (${keys.join(',')})`, infoFields(pointsId), keys.length, ctx.signal) : [];
          for (const r of raw) jira[String(r.key)] = mapInfo(r, pointsId);
        } catch {
          // the Jira info is optional; the overview shows a dash
        }
      }
      return jira;
    };
    const [prs, jira] = await Promise.all([loadPrs(), loadJira()]);
    const pods = latestPods();
    const { links, unlinked } = linkTickets(
      tickets.map((t) => t.key),
      prs,
      pods,
      config.keyPattern,
      Object.fromEntries(tickets.filter((t) => t.podLinks?.length).map((t) => [t.key, t.podLinks!])),
      Object.fromEntries(tickets.filter((t) => t.aliases?.length).map((t) => [t.key, t.aliases!])),
    );
    const statuses = parseStatuses(config.statuses ?? '');
    if (config.connection && !prError) {
      const now = Date.now();
      const ready = config.readyLabel || 'ready to merge';
      const plan0 = planAutoMoves(stored.tickets, links, statuses, stored.autoMoveMemory, config.autoMove !== false, ready);
      if (plan0.moves.length || memorySig(plan0.memory) !== memorySig(stored.autoMoveMemory)) {
        const saved = await store.update((s) => {
          const plan = planAutoMoves(s.tickets, links, statuses, s.autoMoveMemory, config.autoMove !== false, ready);
          let list = s.tickets;
          for (const m of plan.moves) {
            list = move(list, m.id, m.status, Number.MAX_SAFE_INTEGER, now).map((t) => (t.id === m.id ? { ...t, autoMovedAt: now } : t));
          }
          return { tickets: list, autoMoveMemory: plan.memory };
        });
        tickets = saved.tickets;
      }
    }
    return { statuses, tickets, links, unlinked, pods, jira, ...(prError ? { prError } : {}) };
  },
  actions: {
    async add(payload, config, ctx) {
      const p = payloadOf(payload);
      const key = extractKey(str(p.key, 200), config.keyPattern);
      if (!key) throw invalid('ticket-invalid-key', 'Not a ticket key.');
      const status = parseStatuses(config.statuses ?? '')[0]!;
      const description = str(p.description);
      let pcr = parsePcr(str(p.pcr, 20));
      if (!pcr && config.jiraConnection && /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key)) {
        try {
          const conn = await ctx.connection(config.jiraConnection, 'jira');
          const [raw] = await search(conn, `key = ${key}`, ['summary', 'parent', 'labels', 'issuelinks'], 1, ctx.signal);
          if (raw) pcr = pcrOf(raw);
        } catch {
          // the PCR is optional; it can be typed in the side panel
        }
      }
      const saved = await ticketsStore(ctx.dataDir).update((s) => {
        if (s.tickets.some((t) => t.key === key)) throw invalid('ticket-duplicate', 'The ticket is already on the board.', { key });
        if (s.tickets.length >= MAX_TICKETS) throw invalid('ticket-limit', 'The board is full.');
        return { ...s, tickets: add(s.tickets, key, status, description, undefined, pcr) };
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
      const patch: Parameters<typeof update>[2] = {};
      if ('description' in p) patch.description = str(p.description);
      if ('pcr' in p) patch.pcr = parsePcr(str(p.pcr, 20));
      return (await ticketsStore(ctx.dataDir).update((s) => ({ ...s, tickets: update(s.tickets, str(p.id, 100), patch) }))).tickets;
    },
    async 'link-key'(payload, _config, ctx) {
      const p = payloadOf(payload);
      const key = str(p.key, 100).toUpperCase();
      if (!key) throw invalid('ticket-invalid-key', 'Not a ticket key.');
      return (
        await ticketsStore(ctx.dataDir).update((s) => ({
          ...s,
          tickets: s.tickets.map((t) => {
            if (t.id !== str(p.id, 100) || t.key.toUpperCase() === key || t.aliases?.includes(key)) return t;
            return { ...t, aliases: [...(t.aliases ?? []), key].slice(0, 50) };
          }),
        }))
      ).tickets;
    },
    async 'link-pod'(payload, _config, ctx) {
      const p = payloadOf(payload);
      const pod = normPodId(str(p.pod, 500));
      if (!pod) throw invalid('ticket-invalid-pod', 'Not a pod.');
      const on = p.linked !== false;
      return (
        await ticketsStore(ctx.dataDir).update((s) => ({
          ...s,
          tickets: s.tickets.map((t) => {
            if (t.id !== str(p.id, 100)) return t;
            const rest = (t.podLinks ?? []).filter((x) => normPodId(x) !== pod);
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
